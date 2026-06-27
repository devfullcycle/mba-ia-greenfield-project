import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import storageConfig from '../config/storage.config';
import { ChannelsService } from '../channels/channels.service';
import { ObjectRange, StorageService } from '../storage/storage.service';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitUploadDto } from './dto/init-upload.dto';
import { Video } from './entities/video.entity';
import { generatePublicId } from './public-id.util';
import { VideoQueueService } from './video-queue.service';
import { storageKey, VideoStatus } from './videos.constants';
import {
  ChannelNotFoundException,
  VideoForbiddenException,
  VideoInvalidStateException,
  VideoNotFoundException,
  VideoNotReadyException,
} from './videos.exceptions';

const PG_UNIQUE_VIOLATION = '23505';
const MAX_PUBLIC_ID_RETRIES = 5;

function isPublicIdConflict(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as { code?: string; detail?: string };
  return (
    e.code === PG_UNIQUE_VIOLATION &&
    typeof e.detail === 'string' &&
    e.detail.includes('public_id')
  );
}

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const safe = base.replace(/[^\w.-]+/g, '_').slice(0, 200);
  return safe.length > 0 ? safe : 'file';
}

export interface InitUploadResult {
  videoId: string;
  uploadId: string;
  partSize: number;
  partCount: number;
}

export interface PublicVideoMetadata {
  videoId: string;
  title: string;
  status: VideoStatus;
  durationSeconds: number | null;
  hasThumbnail: boolean;
  createdAt: Date;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly channels: ChannelsService,
    private readonly storage: StorageService,
    private readonly queue: VideoQueueService,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  async initUpload(
    userId: string,
    dto: InitUploadDto,
  ): Promise<InitUploadResult> {
    const channel = await this.channels.findByUserId(userId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }

    const video = await this.persistDraft(channel.id, dto);

    const key = storageKey.original(video.id, sanitizeFilename(dto.filename));
    const uploadId = await this.storage.createMultipartUpload(
      key,
      dto.contentType,
    );

    video.storage_key = key;
    video.upload_id = uploadId;
    await this.videos.save(video);

    const partSize = this.config.uploadPartSize;
    const partCount = Math.max(1, Math.ceil(dto.size / partSize));

    return { videoId: video.public_id, uploadId, partSize, partCount };
  }

  async getPartUrl(
    userId: string,
    publicId: string,
    partNumber: number,
  ): Promise<{ partNumber: number; url: string }> {
    const video = await this.findByPublicIdOrThrow(publicId, true);
    this.assertOwner(video, userId);
    this.assertStatus(video, VideoStatus.DRAFT);

    const url = await this.storage.getPresignedPartUrl(
      video.storage_key as string,
      video.upload_id as string,
      partNumber,
    );
    return { partNumber, url };
  }

  async completeUpload(
    userId: string,
    publicId: string,
    dto: CompleteUploadDto,
  ): Promise<{ videoId: string; status: VideoStatus }> {
    const video = await this.findByPublicIdOrThrow(publicId, true);
    this.assertOwner(video, userId);
    this.assertStatus(video, VideoStatus.DRAFT);

    await this.storage.completeMultipartUpload(
      video.storage_key as string,
      video.upload_id as string,
      dto.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
    );

    video.status = VideoStatus.PROCESSING;
    video.upload_id = null;
    await this.videos.save(video);

    await this.queue.enqueueProcessing(video.id);

    return { videoId: video.public_id, status: video.status };
  }

  async getPublicMetadata(publicId: string): Promise<PublicVideoMetadata> {
    const video = await this.findByPublicIdOrThrow(publicId);
    return {
      videoId: video.public_id,
      title: video.title,
      status: video.status,
      durationSeconds: video.duration_seconds,
      hasThumbnail: video.thumbnail_key !== null,
      createdAt: video.created_at,
    };
  }

  async openStream(publicId: string, range?: string): Promise<ObjectRange> {
    const video = await this.findByPublicIdOrThrow(publicId);
    this.assertReady(video);
    return this.storage.getObjectRange(video.storage_key as string, range);
  }

  async openDownload(
    publicId: string,
  ): Promise<{ object: ObjectRange; filename: string }> {
    const video = await this.findByPublicIdOrThrow(publicId);
    this.assertReady(video);
    const object = await this.storage.getObjectRange(
      video.storage_key as string,
    );
    return {
      object,
      filename: video.original_filename ?? `${video.public_id}.mp4`,
    };
  }

  async openThumbnail(publicId: string): Promise<ObjectRange> {
    const video = await this.findByPublicIdOrThrow(publicId);
    if (!video.thumbnail_key) {
      throw new VideoNotFoundException();
    }
    return this.storage.getObjectRange(video.thumbnail_key);
  }

  private async persistDraft(
    channelId: string,
    dto: InitUploadDto,
  ): Promise<Video> {
    for (let attempt = 0; attempt < MAX_PUBLIC_ID_RETRIES; attempt++) {
      try {
        return await this.videos.save(
          this.videos.create({
            public_id: generatePublicId(),
            channel_id: channelId,
            title: dto.title,
            original_filename: dto.filename,
            size_bytes: String(dto.size),
            status: VideoStatus.DRAFT,
          }),
        );
      } catch (err) {
        if (isPublicIdConflict(err)) {
          continue;
        }
        throw err;
      }
    }
    throw new Error('Could not generate a unique public_id after retries');
  }

  private async findByPublicIdOrThrow(
    publicId: string,
    withChannel = false,
  ): Promise<Video> {
    const video = await this.videos.findOne({
      where: { public_id: publicId },
      ...(withChannel ? { relations: { channel: true } } : {}),
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  private assertOwner(video: Video, userId: string): void {
    if (video.channel.user_id !== userId) {
      throw new VideoForbiddenException();
    }
  }

  private assertStatus(video: Video, expected: VideoStatus): void {
    if (video.status !== expected) {
      throw new VideoInvalidStateException();
    }
  }

  private assertReady(video: Video): void {
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }
  }
}
