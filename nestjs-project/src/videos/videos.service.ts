import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { nanoid } from 'nanoid';
import { Repository } from 'typeorm';
import { VideoProcessingProducer } from '../queue/video-processing.producer';
import { StorageService, UploadPartUrl } from '../storage/storage.service';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { Video, VideoStatus } from './entities/video.entity';
import {
  FileTooLargeException,
  ForbiddenVideoAccessException,
  InvalidUploadStateException,
  MultipartCompletionFailedException,
  UploadAlreadyCompletedException,
  VideoNotFoundException,
  VideoNotReadyException,
} from './exceptions/video.exceptions';

const STREAM_URL_EXPIRATION_SECONDS = 900;

const TEN_GB_BYTES = 10 * 1024 * 1024 * 1024;
const PART_SIZE_BYTES = 10 * 1024 * 1024;
const PUBLIC_ID_LENGTH = 12;

export interface InitiateUploadResult {
  id: string;
  upload_id: string;
  parts: UploadPartUrl[];
}

function extractExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? '' : filename.slice(lastDot);
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly videoProcessingProducer: VideoProcessingProducer,
  ) {}

  async initiateUpload(
    channelId: string,
    dto: InitiateUploadDto,
  ): Promise<InitiateUploadResult> {
    if (dto.size_bytes > TEN_GB_BYTES) {
      throw new FileTooLargeException();
    }

    const videoId = randomUUID();
    const key = `videos/${channelId}/${videoId}/original${extractExtension(dto.original_filename)}`;
    const partCount = Math.ceil(dto.size_bytes / PART_SIZE_BYTES);

    const { uploadId } = await this.storageService.createMultipartUpload(
      key,
      dto.content_type,
    );

    const publicId = nanoid(PUBLIC_ID_LENGTH);
    await this.videoRepository.save(
      this.videoRepository.create({
        id: videoId,
        public_id: publicId,
        channel_id: channelId,
        original_filename: dto.original_filename,
        original_key: key,
        upload_id: uploadId,
      }),
    );

    const parts = await this.storageService.getUploadPartUrls(
      key,
      uploadId,
      partCount,
    );

    return { id: publicId, upload_id: uploadId, parts };
  }

  async completeUpload(
    channelId: string,
    publicId: string,
    dto: CompleteUploadDto,
  ): Promise<{ id: string; status: VideoStatus }> {
    const video = await this.findOwnedVideo(channelId, publicId);
    if (video.status !== VideoStatus.RASCUNHO) {
      throw new UploadAlreadyCompletedException();
    }

    let sizeBytes: number;
    try {
      await this.storageService.completeMultipartUpload(
        video.original_key!,
        video.upload_id!,
        dto.parts,
      );
      sizeBytes = await this.storageService.getObjectSize(video.original_key!);
    } catch {
      throw new MultipartCompletionFailedException();
    }

    video.status = VideoStatus.PROCESSANDO;
    video.upload_id = null;
    video.size_bytes = String(sizeBytes);
    await this.videoRepository.save(video);

    await this.videoProcessingProducer.emitProcessingJob(
      video.id,
      video.original_key!,
    );

    return { id: video.public_id, status: video.status };
  }

  async abortUpload(channelId: string, publicId: string): Promise<void> {
    const video = await this.findOwnedVideo(channelId, publicId);
    if (video.status !== VideoStatus.RASCUNHO) {
      throw new InvalidUploadStateException();
    }

    await this.storageService.abortMultipartUpload(
      video.original_key!,
      video.upload_id!,
    );
    await this.videoRepository.remove(video);
  }

  async findByPublicId(
    publicId: string,
    requesterChannelId?: string,
  ): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    const isOwner =
      requesterChannelId !== undefined &&
      video.channel_id === requesterChannelId;
    if (video.status !== VideoStatus.PRONTO && !isOwner) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  async getStreamUrl(
    publicId: string,
    requesterChannelId?: string,
  ): Promise<string> {
    const video = await this.findByPublicId(publicId, requesterChannelId);
    if (video.status !== VideoStatus.PRONTO) {
      throw new VideoNotReadyException();
    }
    return this.storageService.getPresignedGetUrl(video.original_key!, {
      expiresIn: STREAM_URL_EXPIRATION_SECONDS,
    });
  }

  async getDownloadUrl(
    publicId: string,
    requesterChannelId?: string,
  ): Promise<string> {
    const video = await this.findByPublicId(publicId, requesterChannelId);
    if (video.status !== VideoStatus.PRONTO) {
      throw new VideoNotReadyException();
    }
    return this.storageService.getPresignedGetUrl(video.original_key!, {
      expiresIn: STREAM_URL_EXPIRATION_SECONDS,
      responseContentDisposition: `attachment; filename="${video.original_filename}"`,
    });
  }

  private async findOwnedVideo(
    channelId: string,
    publicId: string,
  ): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.channel_id !== channelId) {
      throw new ForbiddenVideoAccessException();
    }
    return video;
  }
}
