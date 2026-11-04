import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { isUUID } from 'class-validator';
import { createReadStream, unlink } from 'node:fs';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { Repository } from 'typeorm';
import storageConfig from '../config/storage.config';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';
import type { VideoProcessingJob } from '../queue/jobs/video-processing.job';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';

export interface VideoStreamResult {
  stream: Readable;
  headers: Record<string, string | number>;
  status: number;
}

export interface VideoDownloadResult {
  stream: Readable;
  filename: string;
  contentLength: number;
}

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly channelsService: ChannelsService,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly videoQueue: Queue<VideoProcessingJob>,
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
  ) {}

  async uploadVideo(userId: string, file: Express.Multer.File): Promise<Video> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }

    const video = this.videoRepository.create({
      title: null,
      description: null,
      status: VideoStatus.PENDING_UPLOAD,
      duration_seconds: null,
      original_filename: file.originalname,
      storage_key: null,
      thumbnail_key: null,
      error_message: null,
      channel_id: channel.id,
    });
    await this.videoRepository.save(video);

    const storageKey = `videos/${video.id}/${this.safeFilename(file.originalname)}`;

    try {
      await this.storageService.uploadStream(
        storageKey,
        this.createUploadStream(file),
        file.mimetype || 'application/octet-stream',
        this.storageCfg.bucketVideos,
      );

      video.storage_key = storageKey;
      video.status = VideoStatus.PROCESSING;
      await this.videoRepository.save(video);

      await this.publishVideoProcessingJob(video.id, storageKey);

      return video;
    } finally {
      await this.removeUploadedFile(file);
    }
  }

  async findVideoById(videoId: string): Promise<Video> {
    if (!isUUID(videoId)) {
      throw new VideoNotFoundException();
    }

    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }

    return video;
  }

  async streamVideo(
    videoId: string,
    rangeHeader?: string,
  ): Promise<VideoStreamResult> {
    const video = await this.findVideoById(videoId);
    this.assertVideoReady(video);

    const object = await this.storageService.getObjectStream(
      video.storage_key as string,
      this.storageCfg.bucketVideos,
      rangeHeader,
    );

    const headers: Record<string, string | number> = {
      'Content-Type': object.contentType ?? 'video/mp4',
      'Content-Length': object.contentLength,
      'Accept-Ranges': 'bytes',
    };
    if (object.contentRange) {
      headers['Content-Range'] = object.contentRange;
    }

    return {
      stream: object.stream,
      headers,
      status: object.contentRange ? 206 : 200,
    };
  }

  async downloadVideo(videoId: string): Promise<VideoDownloadResult> {
    const video = await this.findVideoById(videoId);
    this.assertVideoReady(video);

    const object = await this.storageService.getObjectStream(
      video.storage_key as string,
      this.storageCfg.bucketVideos,
    );

    return {
      stream: object.stream,
      filename: video.original_filename,
      contentLength: object.contentLength,
    };
  }

  async publishVideoProcessingJob(
    videoId: string,
    storageKey: string,
  ): Promise<void> {
    try {
      await this.videoQueue.add(
        PROCESS_VIDEO_JOB,
        {
          videoId,
          storageKey,
          bucket: this.storageCfg.bucketVideos,
        },
        { jobId: `video-${videoId}` },
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish processing job for video ${videoId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private assertVideoReady(video: Video): void {
    if (video.status !== VideoStatus.READY || !video.storage_key) {
      throw new VideoNotReadyException();
    }
  }

  private createUploadStream(file: Express.Multer.File): Readable {
    if (file.path) {
      return createReadStream(file.path);
    }
    if (file.buffer) {
      return Readable.from(file.buffer);
    }
    throw new Error('Uploaded file has no readable content');
  }

  private async removeUploadedFile(file: Express.Multer.File): Promise<void> {
    if (!file.path) return;

    await new Promise<void>((resolve) => {
      unlink(file.path, () => resolve());
    });
  }

  private safeFilename(filename: string): string {
    return basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}
