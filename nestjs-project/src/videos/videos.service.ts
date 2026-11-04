import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import * as crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import { Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  InvalidByteRangeException,
  UnsupportedVideoFormatException,
  VideoFileTooLargeException,
  VideoForbiddenException,
  VideoInvalidStateException,
  VideoNotFoundException,
  VideoNotReadyException,
  VideoUploadIncompleteException,
} from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import {
  ALLOWED_VIDEO_MIME_TYPES,
  InitiateUploadDto,
} from './dto/initiate-upload.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { generateVideoSlug } from './slug.util';

export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const PROCESS_VIDEO_JOB = 'process-video';
const MAX_SLUG_RETRIES = 5;
const MAX_S3_MULTIPART_PARTS = 10000;
const INITIAL_PRESIGNED_PARTS_LIMIT = 20;

const MIME_TO_EXTENSION: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
};

export interface PresignedPartUrlItem {
  part_number: number;
  upload_url: string;
}

export interface InitiateUploadResponse {
  id: string;
  slug: string;
  status: VideoStatus;
  upload_id: string;
  storage_key: string;
  part_size: number;
  total_parts: number;
  presigned_urls: PresignedPartUrlItem[];
}

export interface VideoPublicDetails {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: VideoStatus;
  size_bytes: number;
  mime_type: string;
  original_filename: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  channel_id: string;
  stream_url: string;
  download_url: string;
  thumbnail_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface VideoStreamPayload {
  isPartial: boolean;
  stream: Readable;
  contentType: string;
  contentLength: number;
  contentRange?: string;
  totalSizeBytes: number;
}

export interface VideoDownloadPayload {
  stream: Readable;
  contentType: string;
  contentLength: number;
  filename: string;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly videoQueue: Queue,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  async initiateUpload(
    userId: string,
    dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponse> {
    if (dto.size_bytes > this.config.maxUploadSizeBytes) {
      throw new VideoFileTooLargeException();
    }

    if (
      !ALLOWED_VIDEO_MIME_TYPES.includes(
        dto.mime_type as (typeof ALLOWED_VIDEO_MIME_TYPES)[number],
      )
    ) {
      throw new UnsupportedVideoFormatException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }

    const slug = await this.generateUniqueSlug();
    const videoId = crypto.randomUUID();
    const extension = MIME_TO_EXTENSION[dto.mime_type] ?? 'mp4';
    const storageKey = `videos/${videoId}/original.${extension}`;

    const uploadId = await this.storageService.createMultipartUpload(
      storageKey,
      dto.mime_type,
    );

    const minPartSizeFor10kLimit = Math.ceil(
      dto.size_bytes / MAX_S3_MULTIPART_PARTS,
    );
    const partSize = Math.max(
      this.config.partSizeBytes,
      minPartSizeFor10kLimit,
    );
    const totalParts = Math.max(1, Math.ceil(dto.size_bytes / partSize));

    const draft = this.videoRepository.create({
      id: videoId,
      channel_id: channel.id,
      slug,
      title: dto.title,
      description: dto.description ?? null,
      status: VideoStatus.DRAFT,
      storage_key: storageKey,
      upload_id: uploadId,
      original_filename: dto.original_filename,
      mime_type: dto.mime_type,
      size_bytes: dto.size_bytes,
    });

    const saved = await this.videoRepository.save(draft);

    const initialPartsToSign = Math.min(
      totalParts,
      INITIAL_PRESIGNED_PARTS_LIMIT,
    );
    const presignedUrls: PresignedPartUrlItem[] = [];
    for (let partNumber = 1; partNumber <= initialPartsToSign; partNumber++) {
      const uploadUrl = await this.storageService.getPresignedUploadPartUrl(
        storageKey,
        uploadId,
        partNumber,
        this.config.presignedUrlExpirationSeconds,
      );
      presignedUrls.push({
        part_number: partNumber,
        upload_url: uploadUrl,
      });
    }

    return {
      id: saved.id,
      slug: saved.slug,
      status: saved.status,
      upload_id: uploadId,
      storage_key: storageKey,
      part_size: partSize,
      total_parts: totalParts,
      presigned_urls: presignedUrls,
    };
  }

  async getPresignedPartUrl(
    userId: string,
    videoId: string,
    partNumber: number,
  ): Promise<{ part_number: number; upload_url: string; expires_in: number }> {
    const video = await this.findOwnedVideo(userId, videoId);

    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new VideoInvalidStateException(
        'Video upload is not in draft state',
      );
    }

    const uploadUrl = await this.storageService.getPresignedUploadPartUrl(
      video.storage_key,
      video.upload_id,
      partNumber,
      this.config.presignedUrlExpirationSeconds,
    );

    return {
      part_number: partNumber,
      upload_url: uploadUrl,
      expires_in: this.config.presignedUrlExpirationSeconds,
    };
  }

  async completeUpload(
    userId: string,
    videoId: string,
    dto: CompleteUploadDto,
  ): Promise<{ id: string; slug: string; status: VideoStatus }> {
    const video = await this.findOwnedVideo(userId, videoId);

    if (video.status !== VideoStatus.DRAFT) {
      throw new VideoInvalidStateException(
        'Only draft videos can complete upload',
      );
    }

    if (dto.parts && dto.parts.length > 0 && video.upload_id) {
      await this.storageService.completeMultipartUpload(
        video.storage_key,
        video.upload_id,
        dto.parts.map((p) => ({
          partNumber: p.part_number,
          etag: p.etag,
        })),
      );
    }

    const head = await this.storageService.headObject(video.storage_key);
    if (!head || head.contentLength <= 0) {
      throw new VideoUploadIncompleteException();
    }

    video.status = VideoStatus.PROCESSING;
    video.upload_id = null;
    video.size_bytes = head.contentLength;
    await this.videoRepository.save(video);

    await this.videoQueue.add(
      PROCESS_VIDEO_JOB,
      {
        videoId: video.id,
        storageKey: video.storage_key,
      },
      {
        jobId: `video-${video.id}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    );

    return {
      id: video.id,
      slug: video.slug,
      status: video.status,
    };
  }

  async abortUpload(userId: string, videoId: string): Promise<void> {
    const video = await this.findOwnedVideo(userId, videoId);

    if (video.status !== VideoStatus.DRAFT) {
      throw new VideoInvalidStateException(
        'Only draft videos can abort upload',
      );
    }

    if (video.upload_id) {
      await this.storageService
        .abortMultipartUpload(video.storage_key, video.upload_id)
        .catch(() => undefined);
    }

    await this.videoRepository.delete({ id: video.id });
  }

  async findBySlug(slug: string): Promise<VideoPublicDetails> {
    const video = await this.videoRepository.findOne({ where: { slug } });
    if (!video) {
      throw new VideoNotFoundException();
    }

    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      description: video.description,
      status: video.status,
      size_bytes: video.size_bytes,
      mime_type: video.mime_type,
      original_filename: video.original_filename,
      duration_seconds: video.duration_seconds,
      width: video.width,
      height: video.height,
      codec: video.codec,
      channel_id: video.channel_id,
      stream_url: `/videos/${video.slug}/stream`,
      download_url: `/videos/${video.slug}/download`,
      thumbnail_url:
        video.status === VideoStatus.READY && video.thumbnail_key
          ? `/videos/${video.slug}/thumbnail`
          : null,
      created_at: video.created_at,
      updated_at: video.updated_at,
    };
  }

  parseByteRange(
    rangeHeader: string,
    totalSizeBytes: number,
  ): { start: number; end: number } {
    if (totalSizeBytes <= 0 || !rangeHeader.startsWith('bytes=')) {
      throw new InvalidByteRangeException(totalSizeBytes);
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      throw new InvalidByteRangeException(totalSizeBytes);
    }

    const [, startStr, endStr] = match;
    if (startStr === '' && endStr === '') {
      throw new InvalidByteRangeException(totalSizeBytes);
    }

    let start: number;
    let end: number;

    if (startStr === '') {
      // Suffix byte-range-spec: bytes=-500
      const suffixLength = parseInt(endStr, 10);
      if (Number.isNaN(suffixLength) || suffixLength <= 0) {
        throw new InvalidByteRangeException(totalSizeBytes);
      }
      start = Math.max(0, totalSizeBytes - suffixLength);
      end = totalSizeBytes - 1;
    } else {
      start = parseInt(startStr, 10);
      if (endStr === '') {
        // Open-ended range: bytes=0- -> clamp to partSizeBytes chunk window or end of file
        end = Math.min(
          totalSizeBytes - 1,
          start + this.config.partSizeBytes - 1,
        );
      } else {
        end = Math.min(totalSizeBytes - 1, parseInt(endStr, 10));
      }
    }

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      start >= totalSizeBytes ||
      start > end
    ) {
      throw new InvalidByteRangeException(totalSizeBytes);
    }

    return { start, end };
  }

  async getVideoStreamBySlug(
    slug: string,
    rangeHeader?: string,
  ): Promise<VideoStreamPayload> {
    const video = await this.videoRepository.findOne({ where: { slug } });
    if (!video) {
      throw new VideoNotFoundException();
    }

    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    if (rangeHeader) {
      const { start, end } = this.parseByteRange(rangeHeader, video.size_bytes);
      const s3Result = await this.storageService.getObjectStream(
        video.storage_key,
        { start, end },
      );

      return {
        isPartial: true,
        stream: s3Result.stream,
        contentType: video.mime_type,
        contentLength: end - start + 1,
        contentRange: `bytes ${start}-${end}/${video.size_bytes}`,
        totalSizeBytes: video.size_bytes,
      };
    }

    const s3Result = await this.storageService.getObjectStream(
      video.storage_key,
    );
    return {
      isPartial: false,
      stream: s3Result.stream,
      contentType: video.mime_type,
      contentLength: video.size_bytes,
      totalSizeBytes: video.size_bytes,
    };
  }

  async getVideoDownloadBySlug(slug: string): Promise<VideoDownloadPayload> {
    const video = await this.videoRepository.findOne({ where: { slug } });
    if (!video) {
      throw new VideoNotFoundException();
    }

    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    const s3Result = await this.storageService.getObjectStream(
      video.storage_key,
    );
    const sanitizedFilename = video.original_filename.replace(
      /[^a-zA-Z0-9._-]/g,
      '_',
    );

    return {
      stream: s3Result.stream,
      contentType: video.mime_type,
      contentLength: video.size_bytes,
      filename: sanitizedFilename || `${video.slug}.mp4`,
    };
  }

  async getThumbnailStreamBySlug(
    slug: string,
  ): Promise<{ stream: Readable; contentType: string; contentLength: number }> {
    const video = await this.videoRepository.findOne({ where: { slug } });
    if (!video) {
      throw new VideoNotFoundException();
    }

    if (video.status !== VideoStatus.READY || !video.thumbnail_key) {
      throw new VideoNotReadyException();
    }

    const s3Result = await this.storageService.getObjectStream(
      video.thumbnail_key,
    );
    return {
      stream: s3Result.stream,
      contentType: 'image/jpeg',
      contentLength: s3Result.contentLength,
    };
  }

  private async findOwnedVideo(
    userId: string,
    videoId: string,
  ): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel || video.channel_id !== channel.id) {
      throw new VideoForbiddenException();
    }

    return video;
  }

  private async generateUniqueSlug(): Promise<string> {
    for (let attempt = 0; attempt <= MAX_SLUG_RETRIES; attempt++) {
      const slug = generateVideoSlug();
      const existing = await this.videoRepository.findOne({ where: { slug } });
      if (!existing) {
        return slug;
      }
    }
    throw new Error('Could not generate a unique video slug after max retries');
  }
}
