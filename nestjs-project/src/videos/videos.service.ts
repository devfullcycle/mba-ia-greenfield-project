import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { ConfigType } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import { Video } from './entities/video.entity';
import { assertTransition, VideoStatus } from './video-status';
import {
  FileTooLargeException,
  InvalidVideoStateException,
  NotVideoOwnerException,
  RangeNotSatisfiableException,
  UnsupportedMediaTypeException,
  UploadIncompleteException,
  VideoNotFoundException,
} from './exceptions/video.exceptions';
import { PublicIdService } from './services/public-id.service';
import { VideoQueueService } from './services/video-queue.service';
import type { UploadedPartDto } from './dto/complete-upload.dto';
import type { InitiateUploadDto } from './dto/initiate-upload.dto';

export interface VideoView {
  publicId: string;
  title: string;
  status: VideoStatus;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  channel: { nickname: string; name: string } | null;
  createdAt: Date;
}

export interface InitiateUploadResult {
  videoId: string;
  publicId: string;
  status: VideoStatus;
  uploadId: string;
  partSize: number;
  parts: { partNumber: number; url: string }[];
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channels: Repository<Channel>,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
    private readonly storage: StorageService,
    private readonly publicIds: PublicIdService,
    private readonly queue: VideoQueueService,
  ) {}

  /**
   * Pre-registers the video as a draft and opens a multipart upload, returning
   * one presigned URL per part. The file bytes never pass through the API.
   */
  async initiateUpload(
    userId: string,
    dto: InitiateUploadDto,
  ): Promise<InitiateUploadResult> {
    if (!dto.contentType.startsWith('video/')) {
      throw new UnsupportedMediaTypeException();
    }
    if (dto.fileSize > this.config.maxSizeBytes) {
      throw new FileTooLargeException();
    }

    const channel = await this.getChannelForUser(userId);
    const publicId = await this.publicIds.generateUnique((id) =>
      this.videos.existsBy({ public_id: id }),
    );
    const storageKey = `videos/${publicId}/source`;
    const uploadId = await this.storage.createMultipartUpload(
      storageKey,
      dto.contentType,
    );

    const video = await this.videos.save(
      this.videos.create({
        public_id: publicId,
        channel_id: channel.id,
        title: dto.title,
        content_type: dto.contentType,
        original_filename: dto.filename,
        size_bytes: dto.fileSize,
        storage_key: storageKey,
        upload_id: uploadId,
        status: VideoStatus.DRAFT,
      }),
    );

    const partSize = this.config.uploadPartSizeBytes;
    const partCount = Math.max(1, Math.ceil(dto.fileSize / partSize));
    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_, i) => ({
        partNumber: i + 1,
        url: await this.storage.presignUploadPart(storageKey, uploadId, i + 1),
      })),
    );

    return {
      videoId: video.id,
      publicId,
      status: video.status,
      uploadId,
      partSize,
      parts,
    };
  }

  /**
   * Finalizes the multipart upload, flips the video to `processing` and enqueues
   * the worker job.
   */
  async completeUpload(
    userId: string,
    videoId: string,
    dto: { parts: UploadedPartDto[] },
  ): Promise<{ publicId: string; status: VideoStatus }> {
    const video = await this.videos.findOneBy({ id: videoId });
    if (!video) {
      throw new VideoNotFoundException();
    }

    const channel = await this.getChannelForUser(userId);
    if (video.channel_id !== channel.id) {
      throw new NotVideoOwnerException();
    }
    if (video.status !== VideoStatus.DRAFT) {
      throw new InvalidVideoStateException();
    }
    if (!video.upload_id) {
      throw new UploadIncompleteException();
    }

    try {
      await this.storage.completeMultipartUpload(
        video.storage_key,
        video.upload_id,
        dto.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
      );
      const head = await this.storage.headObject(video.storage_key);
      video.size_bytes = head.contentLength;
    } catch (err) {
      if (err instanceof UploadIncompleteException) {
        throw err;
      }
      throw new UploadIncompleteException();
    }

    assertTransition(video.status, VideoStatus.PROCESSING);
    video.status = VideoStatus.PROCESSING;
    video.upload_id = null;
    await this.videos.save(video);

    await this.queue.enqueueProcessing(video.id);

    return { publicId: video.public_id, status: video.status };
  }

  /** Reads a byte range of a ready video for streaming (206). */
  async streamByPublicId(publicId: string, range?: string) {
    const video = await this.findReadyByPublicId(publicId);
    try {
      return await this.storage.getObjectRange(video.storage_key, range);
    } catch (err: any) {
      if (
        err?.$metadata?.httpStatusCode === 416 ||
        err?.name === 'InvalidRange'
      ) {
        throw new RangeNotSatisfiableException();
      }
      throw err;
    }
  }

  /** Presigned URL to download the full file of a ready video. */
  async getDownloadUrl(publicId: string): Promise<string> {
    const video = await this.findReadyByPublicId(publicId);
    const filename = video.original_filename ?? `${video.public_id}.mp4`;
    return this.storage.presignDownloadUrl(video.storage_key, filename);
  }

  /** Public read of a video's metadata (status, duration, thumbnail). */
  async getByPublicId(publicId: string): Promise<VideoView> {
    const video = await this.videos.findOne({
      where: { public_id: publicId },
      relations: { channel: true },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    const thumbnailUrl = video.thumbnail_key
      ? await this.storage.presignGetUrl(video.thumbnail_key)
      : null;
    return {
      publicId: video.public_id,
      title: video.title,
      status: video.status,
      durationSeconds: video.duration_seconds,
      thumbnailUrl,
      channel: video.channel
        ? { nickname: video.channel.nickname, name: video.channel.name }
        : null,
      createdAt: video.created_at,
    };
  }

  private async findReadyByPublicId(publicId: string): Promise<Video> {
    const video = await this.videos.findOneBy({ public_id: publicId });
    if (!video || video.status !== VideoStatus.READY) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  private async getChannelForUser(userId: string): Promise<Channel> {
    const channel = await this.channels.findOneBy({ user_id: userId });
    if (!channel) {
      // A user always owns a channel (created at registration); defensive guard.
      throw new VideoNotFoundException();
    }
    return channel;
  }
}
