import * as crypto from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { ConfigType } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { StorageService } from '../storage/storage.service';
import {
  ChannelRequiredException,
  VideoNotFoundException,
  VideoNotDraftException,
  VideoNotReadyException,
  VideoOwnershipException,
  VideoRangeNotSatisfiableException,
  VideoUploadEnqueueException,
} from '../common/exceptions/domain.exception';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import { Video } from './entities/video.entity';
import {
  VideoStatus,
  VIDEO_QUEUE_NAME,
  type VideoProcessingJob,
} from './videos.constants';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { ListVideosQueryDto } from './dto/list-videos-query.dto';

export interface InitiateUploadResult {
  id: string;
  status: VideoStatus;
  upload_url: string;
  storage_key: string;
}

export interface VideoPublicView {
  id: string;
  title: string;
  status: VideoStatus;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  processing_metadata: Video['processing_metadata'];
  channel_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface StreamResult {
  stream: NodeJS.ReadableStream;
  contentType: string;
  contentLength: number;
  contentRange?: string;
  statusCode: number;
}

export interface ListResult {
  items: VideoPublicView[];
  total: number;
  page: number;
  limit: number;
  has_next_page: boolean;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    @InjectQueue(VIDEO_QUEUE_NAME)
    private readonly processingQueue: Queue,
    private readonly storageService: StorageService,
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
  ) {}

  async initiateUpload(
    userId: string,
    dto: InitiateUploadDto,
  ): Promise<InitiateUploadResult> {
    const channel = await this.channelRepository.findOne({
      where: { user_id: userId },
    });
    if (!channel) {
      throw new ChannelRequiredException();
    }

    const videoId = crypto.randomUUID();
    const ext = dto.mime_type.split('/')[1] ?? 'mp4';
    const storageKey = `videos/${videoId}/original.${ext}`;

    const uploadUrl = await this.storageService.generatePresignedPutUrl(
      storageKey,
      dto.mime_type,
    );

    const video = this.videoRepository.create({
      id: videoId,
      title: dto.title,
      status: VideoStatus.DRAFT,
      storage_key: storageKey,
      channel_id: channel.id,
    });
    await this.videoRepository.save(video);

    return {
      id: videoId,
      status: VideoStatus.DRAFT,
      upload_url: uploadUrl,
      storage_key: storageKey,
    };
  }

  async confirmUpload(
    videoId: string,
    userId: string,
  ): Promise<{ id: string; status: VideoStatus }> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
      relations: ['channel'],
    });
    if (!video) {
      throw new VideoNotFoundException(videoId);
    }
    if (video.channel.user_id !== userId) {
      throw new VideoOwnershipException();
    }
    if (video.status !== VideoStatus.DRAFT) {
      throw new VideoNotDraftException();
    }

    const job: VideoProcessingJob = {
      videoId,
      storageKey: video.storage_key,
      bucketName: this.storageService.getBucketName(),
    };

    try {
      await this.processingQueue.add(VIDEO_QUEUE_NAME, job, {
        jobId: videoId,
        attempts: 3,
        backoff: { type: 'fixed', delay: 5000 },
      });
    } catch {
      throw new VideoUploadEnqueueException();
    }

    video.status = VideoStatus.PROCESSING;
    await this.videoRepository.save(video);

    return { id: videoId, status: VideoStatus.PROCESSING };
  }

  async findById(videoId: string): Promise<VideoPublicView> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      throw new VideoNotFoundException(videoId);
    }
    return this.toPublicView(video);
  }

  async streamVideo(
    videoId: string,
    rangeHeader?: string,
  ): Promise<StreamResult> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      throw new VideoNotFoundException(videoId);
    }
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    try {
      const result = await this.storageService.getObject(
        video.storage_key,
        rangeHeader,
      );
      return {
        stream: result.stream,
        contentType: result.contentType,
        contentLength: result.contentLength,
        contentRange: result.contentRange,
        statusCode: rangeHeader ? 206 : 200,
      };
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 416
      ) {
        throw new VideoRangeNotSatisfiableException();
      }
      throw err;
    }
  }

  async listChannelVideos(
    channelId: string,
    userId: string,
    query: ListVideosQueryDto,
  ): Promise<ListResult> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });
    if (!channel || channel.user_id !== userId) {
      throw new VideoOwnershipException();
    }

    const { page, limit } = query;
    const [items, total] = await this.videoRepository.findAndCount({
      where: { channel_id: channelId },
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: items.map((v) => this.toPublicView(v)),
      total,
      page,
      limit,
      has_next_page: page * limit < total,
    };
  }

  async updateTitle(
    videoId: string,
    userId: string,
    dto: UpdateVideoDto,
  ): Promise<{
    id: string;
    title: string;
    status: VideoStatus;
    updated_at: Date;
  }> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
      relations: ['channel'],
    });
    if (!video) {
      throw new VideoNotFoundException(videoId);
    }
    if (video.channel.user_id !== userId) {
      throw new VideoOwnershipException();
    }

    video.title = dto.title;
    const saved = await this.videoRepository.save(video);
    return {
      id: saved.id,
      title: saved.title,
      status: saved.status,
      updated_at: saved.updated_at,
    };
  }

  async deleteVideo(videoId: string, userId: string): Promise<void> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
      relations: ['channel'],
    });
    if (!video) {
      throw new VideoNotFoundException(videoId);
    }
    if (video.channel.user_id !== userId) {
      throw new VideoOwnershipException();
    }

    try {
      const job = await this.processingQueue.getJob(videoId);
      if (job) await job.remove();
    } catch {
      // Job may not exist — tolerate
    }

    await this.storageService.deleteObject(video.storage_key);
    if (video.thumbnail_key) {
      await this.storageService.deleteObject(video.thumbnail_key);
    }

    await this.videoRepository.remove(video);
  }

  async downloadVideo(videoId: string): Promise<{
    stream: NodeJS.ReadableStream;
    contentType: string;
    contentLength: number;
    filename: string;
  }> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      throw new VideoNotFoundException(videoId);
    }
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    const result = await this.storageService.getObject(video.storage_key);
    const ext = video.storage_key.split('.').pop() ?? 'mp4';
    const safeName = video.title.replace(/[^\w\s.-]/g, '').trim() || 'video';
    const filename = `${safeName}.${ext}`;

    return {
      stream: result.stream,
      contentType: result.contentType,
      contentLength: result.contentLength,
      filename,
    };
  }

  private toPublicView(video: Video): VideoPublicView {
    const thumbnailUrl = video.thumbnail_key
      ? `${this.storageCfg.endpoint}/${this.storageCfg.bucket}/${video.thumbnail_key}`
      : null;

    return {
      id: video.id,
      title: video.title,
      status: video.status,
      thumbnail_url: thumbnailUrl,
      duration_seconds: video.duration_seconds,
      processing_metadata: video.processing_metadata,
      channel_id: video.channel_id,
      created_at: video.created_at,
      updated_at: video.updated_at,
    };
  }
}
