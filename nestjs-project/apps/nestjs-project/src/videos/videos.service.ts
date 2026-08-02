import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from '../storage/storage.service';
import storageConfig from '../config/storage.config';
import {
  UploadFinalizationFailedException,
  VideoAlreadyUploadedException,
  VideoNotFoundException,
  VideoNotOwnedException,
} from '../common/exceptions/domain.exception';
import { Video } from './entities/video.entity';
import { CreateVideoDto } from './dto/create-video.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import {
  ProcessVideoJobData,
  VIDEO_PROCESSING_QUEUE,
} from './interfaces/process-video-job.interface';

export interface InitiateUploadResult {
  id: string;
  status: string;
  uploadId: string;
  parts: { partNumber: number; url: string }[];
}

export interface VideoPlaybackResult {
  id: string;
  status: string;
  originalFilename: string;
  durationSeconds: number | null;
  createdAt: Date;
  streamUrl?: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  failureReason?: string;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    @Inject(storageConfig.KEY)
    private readonly storageConfiguration: ConfigType<typeof storageConfig>,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly videoProcessingQueue: Queue<ProcessVideoJobData>,
  ) {}

  async initiateUpload(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<InitiateUploadResult> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new Error('Channel not found for authenticated user');
    }

    const id = randomUUID();
    const storageKey = `videos/${id}/original`;

    const { uploadId } = await this.storageService.createMultipartUpload(
      storageKey,
      dto.mimeType,
    );

    const video = await this.videoRepository.save(
      this.videoRepository.create({
        id,
        channel_id: channel.id,
        original_filename: dto.originalFilename,
        mime_type: dto.mimeType,
        size_bytes: dto.sizeBytes,
        storage_key: storageKey,
        upload_id: uploadId,
      }),
    );

    const partSizeBytes =
      this.storageConfiguration.multipartPartSizeMb * 1024 * 1024;
    const partCount = Math.max(1, Math.ceil(dto.sizeBytes / partSizeBytes));

    const parts = await Promise.all(
      Array.from({ length: partCount }, (_, index) => index + 1).map(
        async (partNumber) => ({
          partNumber,
          url: await this.storageService.getUploadPartUrl(
            storageKey,
            uploadId,
            partNumber,
          ),
        }),
      ),
    );

    return {
      id: video.id,
      status: video.status,
      uploadId,
      parts,
    };
  }

  async completeUpload(
    videoId: string,
    userId: string,
    dto: CompleteUploadDto,
  ): Promise<{ id: string; status: string }> {
    const video = await this.videoRepository.findOneBy({ id: videoId });
    if (!video) {
      throw new VideoNotFoundException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel || video.channel_id !== channel.id) {
      throw new VideoNotOwnedException();
    }
    if (video.status !== 'draft') {
      throw new VideoAlreadyUploadedException();
    }

    try {
      await this.storageService.completeMultipartUpload(
        video.storage_key,
        video.upload_id!,
        dto.parts.map((part) => ({
          partNumber: part.partNumber,
          eTag: part.eTag,
        })),
      );
    } catch {
      throw new UploadFinalizationFailedException();
    }

    video.status = 'processing';
    video.upload_id = null;
    await this.videoRepository.save(video);

    await this.videoProcessingQueue.add('process-video', {
      videoId: video.id,
    });

    return { id: video.id, status: video.status };
  }

  async findForPlayback(videoId: string): Promise<VideoPlaybackResult> {
    const video = await this.videoRepository.findOneBy({ id: videoId });
    if (!video) {
      throw new VideoNotFoundException();
    }

    const base: VideoPlaybackResult = {
      id: video.id,
      status: video.status,
      originalFilename: video.original_filename,
      durationSeconds: video.duration_seconds,
      createdAt: video.created_at,
    };

    if (video.status === 'ready') {
      const streamUrl = await this.storageService.getObjectPresignedUrl(
        video.storage_key,
      );
      const thumbnailUrl = await this.storageService.getObjectPresignedUrl(
        video.thumbnail_key!,
      );
      return {
        ...base,
        streamUrl,
        downloadUrl: streamUrl,
        thumbnailUrl,
      };
    }

    if (video.status === 'failed') {
      return { ...base, failureReason: video.failure_reason ?? undefined };
    }

    return base;
  }
}
