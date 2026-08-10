import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { nanoid } from 'nanoid';
import { DataSource, Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import storageConfig from '../config/storage.config';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { CompletedPartDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { FileTooLargeException } from './exceptions/file-too-large.exception';
import { InvalidVideoStatusException } from './exceptions/invalid-video-status.exception';
import { VideoNotFoundException } from './exceptions/video-not-found.exception';
import { VideoNotOwnedException } from './exceptions/video-not-owned.exception';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 * 1024;
const SLUG_LENGTH = 11;
const MAX_SLUG_GENERATION_ATTEMPTS = 5;

export interface InitiateUploadResult {
  id: string;
  uploadId: string;
  key: string;
  status: VideoStatus;
}

export interface UploadPartUrl {
  partNumber: number;
  url: string;
}

export interface VideoMetadata {
  id: string;
  status: VideoStatus;
  title: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: string;
  durationSeconds: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

function extractExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex === -1 ? '' : filename.slice(dotIndex + 1);
}

function deriveTitle(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex === -1 ? filename : filename.slice(0, dotIndex);
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly dataSource: DataSource,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    private readonly queueService: QueueService,
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
  ) {}

  async initiateUpload(
    userId: string,
    dto: InitiateUploadDto,
  ): Promise<InitiateUploadResult> {
    if (dto.sizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new FileTooLargeException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      // A user without a channel cannot own any video
      throw new VideoNotOwnedException();
    }

    const videoId = randomUUID();
    const key = this.storageService.buildOriginalKey(
      channel.id,
      videoId,
      extractExtension(dto.filename),
    );
    const { uploadId } = await this.storageService.createMultipartUpload(
      key,
      dto.mimeType,
    );
    const slug = await this.generateUniqueSlug();

    const video = await this.videoRepository.save(
      this.videoRepository.create({
        id: videoId,
        slug,
        channel_id: channel.id,
        title: deriveTitle(dto.filename),
        original_filename: dto.filename,
        mime_type: dto.mimeType,
        size_bytes: dto.sizeBytes.toString(),
        original_key: key,
        upload_id: uploadId,
      }),
    );

    return { id: video.slug, uploadId, key, status: video.status };
  }

  private async generateUniqueSlug(): Promise<string> {
    for (let attempt = 0; attempt < MAX_SLUG_GENERATION_ATTEMPTS; attempt++) {
      const slug = nanoid(SLUG_LENGTH);
      const existing = await this.videoRepository.findOneBy({ slug });
      if (!existing) {
        return slug;
      }
    }
    throw new Error(
      `Failed to generate a unique video slug after ${MAX_SLUG_GENERATION_ATTEMPTS} attempts`,
    );
  }

  async getUploadPartUrls(
    userId: string,
    slug: string,
    partNumbers: number[],
  ): Promise<UploadPartUrl[]> {
    const video = await this.findOwnedVideo(userId, slug);
    if (video.status !== 'draft') {
      throw new InvalidVideoStatusException();
    }

    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storageService.presignUploadPart(
          video.original_key,
          video.upload_id!,
          partNumber,
        ),
      })),
    );
  }

  async completeUpload(
    userId: string,
    slug: string,
    parts: CompletedPartDto[],
  ): Promise<{ id: string; status: VideoStatus }> {
    const video = await this.findOwnedVideo(userId, slug);
    if (video.status !== 'draft') {
      throw new InvalidVideoStatusException();
    }

    return this.dataSource.transaction(async (manager) => {
      await this.storageService.completeMultipartUpload(
        video.original_key,
        video.upload_id!,
        parts,
      );

      await manager.update(Video, video.id, {
        status: 'processing',
        upload_id: null,
      });

      await this.queueService.enqueueVideoProcessing(
        {
          videoId: video.id,
          bucket: this.storageCfg.bucket,
          key: video.original_key,
        },
        manager.queryRunner!,
      );

      return { id: video.slug, status: 'processing' as const };
    });
  }

  async reprocess(
    userId: string,
    slug: string,
  ): Promise<{ id: string; status: VideoStatus }> {
    const video = await this.findOwnedVideo(userId, slug);
    if (video.status !== 'failed') {
      throw new InvalidVideoStatusException();
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.update(Video, video.id, {
        status: 'processing',
        failure_reason: null,
      });

      await this.queueService.enqueueVideoProcessing(
        {
          videoId: video.id,
          bucket: this.storageCfg.bucket,
          key: video.original_key,
        },
        manager.queryRunner!,
      );

      return { id: video.slug, status: 'processing' as const };
    });
  }

  async findById(userId: string, slug: string): Promise<VideoMetadata> {
    const video = await this.findOwnedVideo(userId, slug);
    return {
      id: video.slug,
      status: video.status,
      title: video.title,
      originalFilename: video.original_filename,
      mimeType: video.mime_type,
      sizeBytes: video.size_bytes,
      durationSeconds: video.duration_seconds,
      metadata: video.metadata,
      createdAt: video.created_at,
      updatedAt: video.updated_at,
    };
  }

  async getStreamUrl(userId: string, slug: string): Promise<string> {
    const video = await this.findOwnedVideo(userId, slug);
    if (video.status !== 'ready') {
      throw new InvalidVideoStatusException();
    }
    return this.storageService.presignGetObject(video.original_key, 'inline');
  }

  async getDownloadUrl(userId: string, slug: string): Promise<string> {
    const video = await this.findOwnedVideo(userId, slug);
    if (video.status !== 'ready') {
      throw new InvalidVideoStatusException();
    }
    return this.storageService.presignGetObject(
      video.original_key,
      'attachment',
    );
  }

  private async findOwnedVideo(userId: string, slug: string): Promise<Video> {
    const video = await this.videoRepository.findOneBy({ slug });
    if (!video) {
      throw new VideoNotFoundException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel || channel.id !== video.channel_id) {
      throw new VideoNotOwnedException();
    }

    return video;
  }
}
