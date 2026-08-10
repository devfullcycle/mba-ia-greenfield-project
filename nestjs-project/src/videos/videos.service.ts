import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CompletedPart } from '@aws-sdk/client-s3';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelRequiredException,
  VideoAccessDeniedException,
  VideoInvalidStatusException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { StorageService } from '../storage/storage.service';
import { VideoQueueService } from '../queue/video-queue.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { UploadCompleteDto } from './dto/upload-complete.dto';
import { Video } from './entities/video.entity';
import { VideoStatus } from './enums/video-status.enum';

const PART_SIZE = 100_000_000;

export interface CreateDraftResult {
  id: string;
  slug: string;
  storage_key: string;
  parts: { part_number: number; upload_url: string }[];
  part_size: number;
}

export interface PresignedUrlResult {
  url: string;
  expires_at: string;
}

export interface VideoDetails {
  id: string;
  slug: string;
  title: string;
  status: VideoStatus;
  channel_id: string;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

const STREAM_URL_TTL_SECONDS = 3600;
const DOWNLOAD_URL_TTL_SECONDS = 300;
const THUMBNAIL_URL_TTL_SECONDS = 3600;

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    private readonly videoQueueService: VideoQueueService,
  ) {}

  async createDraft(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<CreateDraftResult> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ChannelRequiredException();
    }

    const slug = randomBytes(8).toString('base64url');
    const storageKey = `videos/${slug}/original`;
    const partCount = Math.ceil(dto.file_size / PART_SIZE);
    const contentType = dto.content_type ?? 'video/mp4';

    const uploadId = await this.storageService.createMultipartUpload(
      storageKey,
      contentType,
    );
    const parts = await this.storageService.generatePartPresignedUrls(
      storageKey,
      uploadId,
      partCount,
    );

    const video = this.videoRepository.create({
      channel_id: channel.id,
      title: dto.title,
      slug,
      storage_key: storageKey,
      upload_id: uploadId,
      status: VideoStatus.DRAFT,
    });
    const savedVideo = await this.videoRepository.save(video);

    return {
      id: savedVideo.id,
      slug: savedVideo.slug,
      storage_key: savedVideo.storage_key,
      parts: parts.map((part) => ({
        part_number: part.partNumber,
        upload_url: part.uploadUrl,
      })),
      part_size: PART_SIZE,
    };
  }

  async markUploadComplete(
    videoId: string,
    userId: string,
    dto: UploadCompleteDto,
  ): Promise<void> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
      relations: ['channel'],
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.channel.user_id !== userId) {
      throw new VideoAccessDeniedException();
    }
    if (video.status !== VideoStatus.DRAFT) {
      throw new VideoInvalidStatusException();
    }

    const parts: CompletedPart[] = dto.parts.map((part) => ({
      ETag: part.etag,
      PartNumber: part.part_number,
    }));
    await this.storageService.completeMultipartUpload(
      video.storage_key,
      video.upload_id!,
      parts,
    );

    video.status = VideoStatus.PROCESSING;
    video.upload_id = null;
    await this.videoRepository.save(video);

    await this.videoQueueService.publishProcessingJob({
      videoId: video.id,
      storageKey: video.storage_key,
      channelId: video.channel_id,
      slug: video.slug,
    });
  }

  async markProcessingReady(
    videoId: string,
    data: {
      duration_seconds: number;
      thumbnail_key: string;
      metadata: Record<string, any>;
    },
  ): Promise<void> {
    await this.videoRepository.update(videoId, {
      status: VideoStatus.READY,
      duration_seconds: data.duration_seconds,
      thumbnail_key: data.thumbnail_key,
      metadata: data.metadata,
    });
  }

  async markProcessingError(
    videoId: string,
    errorMessage: string,
  ): Promise<void> {
    await this.videoRepository.update(videoId, {
      status: VideoStatus.ERROR,
      error_message: errorMessage,
    });
  }

  async findBySlug(slug: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { slug },
      relations: ['channel'],
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  async getVideoDetails(slug: string): Promise<VideoDetails> {
    const video = await this.findBySlug(slug);

    const thumbnailUrl = video.thumbnail_key
      ? (
          await this.storageService.generatePresignedGetUrl(
            video.thumbnail_key,
            THUMBNAIL_URL_TTL_SECONDS,
          )
        ).url
      : null;

    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      status: video.status,
      channel_id: video.channel_id,
      duration_seconds: video.duration_seconds,
      thumbnail_url: thumbnailUrl,
      created_at: video.created_at.toISOString(),
      updated_at: video.updated_at.toISOString(),
    };
  }

  async getStreamUrl(slug: string): Promise<PresignedUrlResult> {
    const video = await this.findBySlug(slug);
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    const { url, expiresAt } =
      await this.storageService.generatePresignedGetUrl(
        video.storage_key,
        STREAM_URL_TTL_SECONDS,
      );

    return { url, expires_at: expiresAt.toISOString() };
  }

  async getDownloadUrl(slug: string): Promise<PresignedUrlResult> {
    const video = await this.findBySlug(slug);
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    const { url, expiresAt } =
      await this.storageService.generatePresignedGetUrl(
        video.storage_key,
        DOWNLOAD_URL_TTL_SECONDS,
        `attachment; filename="${video.title}"`,
      );

    return { url, expires_at: expiresAt.toISOString() };
  }
}
