import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  PartNumberOutOfRangeException,
  UnsupportedVideoTypeException,
  UploadIncompleteException,
  UploadNotInProgressException,
  VideoForbiddenException,
  VideoNotFoundException,
  VideoNotReadyException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import { VideoProcessingProducer } from '../queue/video-processing.producer';
import { MultipartUploadRejectedError } from '../storage/storage.errors';
import { StorageService } from '../storage/storage.service';
import type { CompleteUploadResponseDto } from './dto/complete-upload-response.dto';
import type { CompleteUploadDto } from './dto/complete-upload.dto';
import type { InitUploadResponseDto } from './dto/init-upload-response.dto';
import type { InitUploadDto } from './dto/init-upload.dto';
import type { SignPartsResponseDto } from './dto/sign-parts-response.dto';
import type { SignPartsDto } from './dto/sign-parts.dto';
import { Video } from './entities/video.entity';
import { generatePublicId } from './public-id.util';
import { VideoAccessPolicy } from './video-access.policy';
import { ProcessingStatus } from './video.enums';
import {
  ALLOWED_VIDEO_TYPES,
  PG_UNIQUE_VIOLATION,
  PUBLIC_ID_MAX_RETRIES,
  VIDEO_OBJECT_PREFIX,
} from './videos.constants';

function isPublicIdCollision(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as { code?: string; detail?: string };
  return (
    driverError.code === PG_UNIQUE_VIOLATION &&
    (driverError.detail ?? '').includes('public_id')
  );
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    private readonly videoProcessingProducer: VideoProcessingProducer,
    private readonly videoAccessPolicy: VideoAccessPolicy,
    @Inject(storageConfig.KEY)
    private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  async initUpload(
    userId: string,
    dto: InitUploadDto,
  ): Promise<InitUploadResponseDto> {
    if (dto.sizeBytes > this.storage.maxSizeBytes) {
      throw new VideoTooLargeException();
    }
    const extension = this.resolveExtension(dto);

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new Error(`Authenticated user ${userId} has no channel`);
    }

    const video = await this.createDraft(channel.id, dto, extension);

    try {
      video.uploadId = await this.storageService.createMultipartUpload(
        video.objectKey,
        dto.contentType,
      );
      await this.videoRepository.save(video);
    } catch (error) {
      await this.videoRepository.delete({ id: video.id });
      throw error;
    }

    return {
      id: video.publicId,
      partSizeBytes: this.storage.partSizeBytes,
      partCount: Math.ceil(dto.sizeBytes / this.storage.partSizeBytes),
      processingStatus: video.processingStatus,
    };
  }

  async signParts(
    userId: string,
    publicId: string,
    dto: SignPartsDto,
  ): Promise<SignPartsResponseDto> {
    const video = await this.getOwnedVideo(userId, publicId);
    if (
      video.processingStatus !== ProcessingStatus.UPLOADING ||
      !video.uploadId
    ) {
      throw new UploadNotInProgressException();
    }

    const partCount = Math.ceil(
      Number(video.sizeBytes) / this.storage.partSizeBytes,
    );
    const partNumbers = [...new Set(dto.partNumbers)];
    if (partNumbers.some((partNumber) => partNumber > partCount)) {
      throw new PartNumberOutOfRangeException();
    }

    const uploadId = video.uploadId;
    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storageService.presignUploadPart(
          video.objectKey,
          uploadId,
          partNumber,
        ),
      })),
    );

    return {
      parts,
      expiresInSeconds: this.storage.presignUploadTtlSeconds,
    };
  }

  async completeUpload(
    userId: string,
    publicId: string,
    dto: CompleteUploadDto,
  ): Promise<CompleteUploadResponseDto> {
    const video = await this.getOwnedVideo(userId, publicId);

    if (video.processingStatus === ProcessingStatus.UPLOADING) {
      await this.finishMultipartUpload(video, dto);
      video.processingStatus = ProcessingStatus.PROCESSING;
      video.uploadId = null;
      await this.videoRepository.save(video);
    }

    // Idempotent publish: the jobId is the video id, so retrying `complete`
    // after a failed enqueue recovers without creating a second job.
    if (video.processingStatus === ProcessingStatus.PROCESSING) {
      await this.videoProcessingProducer.enqueueProcessVideo(video.id);
    }

    return { id: video.publicId, processingStatus: video.processingStatus };
  }

  private async finishMultipartUpload(
    video: Video,
    dto: CompleteUploadDto,
  ): Promise<void> {
    try {
      await this.storageService.completeMultipartUpload(
        video.objectKey,
        video.uploadId!,
        dto.parts,
      );
    } catch (error) {
      if (error instanceof MultipartUploadRejectedError) {
        throw new UploadIncompleteException();
      }
      throw error;
    }

    const stored = await this.storageService.headObject(video.objectKey);
    if (!stored || stored.contentLength !== Number(video.sizeBytes)) {
      video.processingStatus = ProcessingStatus.FAILED;
      video.failureReason = 'Uploaded size does not match the declared size';
      video.uploadId = null;
      await this.videoRepository.save(video);
      throw new UploadIncompleteException();
    }
  }

  async getStreamUrl(publicId: string): Promise<string> {
    const video = await this.getAccessibleVideo(publicId);
    return this.storageService.presignGet(video.objectKey);
  }

  async getDownloadUrl(publicId: string): Promise<string> {
    const video = await this.getAccessibleVideo(publicId);
    return this.storageService.presignGet(video.objectKey, {
      downloadFilename: video.originalFilename,
    });
  }

  private async getAccessibleVideo(publicId: string): Promise<Video> {
    const video = await this.videoRepository.findOneBy({ publicId });
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (!this.videoAccessPolicy.canAccess(video)) {
      throw new VideoNotReadyException();
    }
    return video;
  }

  private async getOwnedVideo(
    userId: string,
    publicId: string,
  ): Promise<Video> {
    const video = await this.videoRepository.findOneBy({ publicId });
    if (!video) {
      throw new VideoNotFoundException();
    }
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel || channel.id !== video.channelId) {
      throw new VideoForbiddenException();
    }
    return video;
  }

  private resolveExtension(dto: InitUploadDto): string {
    const allowedExtensions = ALLOWED_VIDEO_TYPES[dto.contentType];
    const extension = dto.originalFilename.split('.').pop()?.toLowerCase();
    if (
      !allowedExtensions ||
      !extension ||
      !allowedExtensions.includes(extension)
    ) {
      throw new UnsupportedVideoTypeException();
    }
    return extension;
  }

  private async createDraft(
    channelId: string,
    dto: InitUploadDto,
    extension: string,
  ): Promise<Video> {
    for (let attempt = 0; attempt <= PUBLIC_ID_MAX_RETRIES; attempt++) {
      const id = randomUUID();
      const draft = this.videoRepository.create({
        id,
        publicId: generatePublicId(),
        channelId,
        originalFilename: dto.originalFilename,
        contentType: dto.contentType,
        sizeBytes: String(dto.sizeBytes),
        objectKey: `${VIDEO_OBJECT_PREFIX}/${id}/original.${extension}`,
        uploadId: null,
        processingStatus: ProcessingStatus.UPLOADING,
      });
      try {
        return await this.videoRepository.save(draft);
      } catch (error) {
        if (!isPublicIdCollision(error)) {
          throw error;
        }
      }
    }
    throw new Error('Video publicId collision could not be resolved');
  }
}
