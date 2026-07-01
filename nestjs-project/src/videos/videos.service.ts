import { randomUUID } from 'crypto';
import { basename, extname } from 'path';
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { UploadPartUrlDto } from './dto/upload-part-url.dto';
import {
  FileTooLargeException,
  InvalidVideoStatusTransitionException,
  UnsupportedMediaTypeException,
  UploadPartInvalidException,
  VideoNotFoundException,
} from './exceptions/video.exception';
import { StorageService } from './storage.service';
import { Video, VideoStatus } from './video.entity';
import {
  ACCEPTED_VIDEO_MIME_TYPES,
  MAX_VIDEO_SIZE_BYTES,
  VIDEO_PROCESSING_QUEUE,
  VIDEO_PROCESS_JOB,
} from './videos.constants';

type AcceptedMimeType = (typeof ACCEPTED_VIDEO_MIME_TYPES)[number];

function isAcceptedMimeType(value: string): value is AcceptedMimeType {
  return (ACCEPTED_VIDEO_MIME_TYPES as readonly string[]).includes(value);
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly videoProcessingQueue: Queue,
  ) {}

  async initiateUpload(
    channelId: string,
    dto: InitiateUploadDto,
  ): Promise<{ id: string; status: VideoStatus; uploadId: string }> {
    if (!isAcceptedMimeType(dto.mimeType)) {
      throw new UnsupportedMediaTypeException();
    }
    if (dto.sizeInBytes > MAX_VIDEO_SIZE_BYTES) {
      throw new FileTooLargeException();
    }

    const id = randomUUID();
    const extension = extname(dto.originalFileName);
    const storageKey = `videos/${channelId}/${id}/original${extension}`;
    const uploadId =
      await this.storageService.initiateMultipartUpload(storageKey);

    const video = this.videoRepository.create({
      id,
      channel_id: channelId,
      title: dto.title?.trim() || basename(dto.originalFileName, extension),
      original_file_name: dto.originalFileName,
      mime_type: dto.mimeType,
      size_in_bytes: dto.sizeInBytes,
      storage_key: storageKey,
      upload_id: uploadId,
      status: VideoStatus.DRAFT,
    });
    const saved = await this.videoRepository.save(video);

    return { id: saved.id, status: saved.status, uploadId };
  }

  async getPartUploadUrl(
    videoId: string,
    channelId: string,
    dto: UploadPartUrlDto,
  ): Promise<{ url: string }> {
    if (dto.partNumber < 1) {
      throw new UploadPartInvalidException();
    }

    const video = await this.findOwnedVideoOrThrow(videoId, channelId);
    if (!video.upload_id) {
      throw new InvalidVideoStatusTransitionException();
    }

    const url = await this.storageService.getPresignedPartUploadUrl(
      video.storage_key,
      video.upload_id,
      dto.partNumber,
    );
    return { url };
  }

  async completeUpload(
    videoId: string,
    channelId: string,
    dto: CompleteUploadDto,
  ): Promise<{ id: string; status: VideoStatus }> {
    const video = await this.findOwnedVideoOrThrow(videoId, channelId);
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new InvalidVideoStatusTransitionException();
    }

    await this.storageService.completeMultipartUpload(
      video.storage_key,
      video.upload_id,
      dto.parts.map((part) => ({
        partNumber: part.partNumber,
        etag: part.etag,
      })),
    );

    video.status = VideoStatus.UPLOADED;
    const saved = await this.videoRepository.save(video);

    await this.videoProcessingQueue.add(
      VIDEO_PROCESS_JOB,
      { videoId: saved.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
    );

    return { id: saved.id, status: saved.status };
  }

  private async findOwnedVideoOrThrow(
    videoId: string,
    channelId: string,
  ): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video || video.channel_id !== channelId) {
      throw new VideoNotFoundException();
    }
    return video;
  }
}
