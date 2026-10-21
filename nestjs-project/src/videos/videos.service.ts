import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { JwtPayload } from '../auth/auth.types';
import { ChannelsService } from '../channels/channels.service';
import {
  FileTooLargeException,
  UnsupportedVideoFormatException,
  UploadAlreadyCompletedException,
  UploadIncompleteException,
  VideoForbiddenException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { QUEUES, VideoProcessPayload } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { StartUploadDto } from './dto/start-upload.dto';
import {
  PlaybackUrlResponseDto,
  VideoResponseDto,
} from './dto/video-response.dto';
import { Video } from './entities/video.entity';
import {
  ACCEPTED_VIDEO_CONTENT_TYPES,
  MAX_VIDEO_SIZE_BYTES,
  PART_SIZE_BYTES,
  PLAYBACK_URL_EXPIRES_IN_SECONDS,
  PUBLIC_ID_MAX_ATTEMPTS,
  VideoStatus,
  VideoVisibility,
} from './videos.constants';
import { generatePublicId } from './public-id.util';

const PG_UNIQUE_VIOLATION = '23505';

export interface StartUploadResult {
  public_id: string;
  upload_id: string;
  part_size_bytes: number;
  status: VideoStatus;
  visibility: Video['visibility'];
}

function isPublicIdCollision(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const { code, detail } = error as QueryFailedError & {
    code?: string;
    detail?: string;
  };
  return code === PG_UNIQUE_VIOLATION && !!detail?.includes('public_id');
}

function isStorageClientError(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return status !== undefined && status >= 400 && status < 500;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly channels: ChannelsService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly dataSource: DataSource,
  ) {}

  async startUpload(
    user: JwtPayload,
    dto: StartUploadDto,
  ): Promise<StartUploadResult> {
    if (dto.size_bytes > MAX_VIDEO_SIZE_BYTES) {
      throw new FileTooLargeException();
    }
    const contentType = dto.content_type.split(';')[0].trim().toLowerCase();
    if (!ACCEPTED_VIDEO_CONTENT_TYPES.includes(contentType)) {
      throw new UnsupportedVideoFormatException();
    }

    const channel = await this.channels.findByUserId(user.sub);
    if (!channel) {
      // Every confirmed user owns a channel (created at registration).
      throw new Error(`Channel not found for user ${user.sub}`);
    }

    const video = await this.createDraft(channel.id, dto);
    try {
      video.upload_id = await this.storage.createMultipartUpload(
        video.storage_key,
        contentType,
      );
      await this.videos.save(video);
    } catch (error) {
      await this.videos.delete({ id: video.id });
      throw error;
    }

    return {
      public_id: video.public_id,
      upload_id: video.upload_id,
      part_size_bytes: PART_SIZE_BYTES,
      status: video.status,
      visibility: video.visibility,
    };
  }

  async signParts(
    user: JwtPayload,
    publicId: string,
    partNumbers: number[],
  ): Promise<{ part_number: number; url: string }[]> {
    const video = await this.loadOpenUpload(user, publicId);
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        part_number: partNumber,
        url: await this.storage.presignUploadPart(
          video.storage_key,
          video.upload_id as string,
          partNumber,
        ),
      })),
    );
  }

  async completeUpload(
    user: JwtPayload,
    publicId: string,
    dto: CompleteUploadDto,
  ): Promise<{ public_id: string; status: VideoStatus }> {
    const video = await this.loadOpenUpload(user, publicId);

    try {
      await this.storage.completeMultipartUpload(
        video.storage_key,
        video.upload_id as string,
        dto.parts.map((part) => ({
          partNumber: part.part_number,
          etag: part.etag,
        })),
      );
    } catch (error) {
      if (isStorageClientError(error)) throw new UploadIncompleteException();
      throw error;
    }

    // The status change and the job are written atomically: a failure rolls
    // back both, so there is never a processing job without the update.
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.update(
        Video,
        { id: video.id, status: VideoStatus.UPLOADING },
        { status: VideoStatus.PROCESSING, upload_id: null },
      );
      if (!result.affected) throw new UploadAlreadyCompletedException();
      await this.queue.enqueue<VideoProcessPayload>(
        QUEUES.VIDEO_PROCESS,
        { videoId: video.id },
        { transaction: manager },
      );
    });

    return { public_id: video.public_id, status: VideoStatus.PROCESSING };
  }

  async getVideo(
    publicId: string,
    viewer?: JwtPayload,
  ): Promise<VideoResponseDto> {
    const video = await this.loadVisible(publicId, viewer);
    return {
      public_id: video.public_id,
      status: video.status,
      visibility: video.visibility,
      duration_seconds: video.duration_seconds,
      metadata: video.metadata,
      has_thumbnail: video.thumbnail_key !== null,
    };
  }

  async getPlaybackUrl(
    publicId: string,
    viewer: JwtPayload | undefined,
    options: { download: boolean },
  ): Promise<PlaybackUrlResponseDto> {
    const video = await this.loadVisible(publicId, viewer);
    if (video.status !== VideoStatus.READY) throw new VideoNotReadyException();

    const url = await this.storage.presignGetUrl(video.storage_key, {
      download: options.download,
      filename: video.original_filename,
      expiresIn: PLAYBACK_URL_EXPIRES_IN_SECONDS,
    });
    return { url, expires_in: PLAYBACK_URL_EXPIRES_IN_SECONDS };
  }

  /** Drafts are visible only to their owner; anyone else gets "not found". */
  private async loadVisible(
    publicId: string,
    viewer?: JwtPayload,
  ): Promise<Video> {
    const video = await this.videos.findOne({ where: { public_id: publicId } });
    if (!video) throw new VideoNotFoundException();
    if (video.visibility === VideoVisibility.PUBLISHED) return video;

    const channel = viewer
      ? await this.channels.findByUserId(viewer.sub)
      : null;
    if (!channel || channel.id !== video.channel_id) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  private async loadOpenUpload(
    user: JwtPayload,
    publicId: string,
  ): Promise<Video> {
    const video = await this.videos.findOne({ where: { public_id: publicId } });
    if (!video) throw new VideoNotFoundException();

    const channel = await this.channels.findByUserId(user.sub);
    if (!channel || channel.id !== video.channel_id) {
      throw new VideoForbiddenException();
    }
    if (video.status !== VideoStatus.UPLOADING || !video.upload_id) {
      throw new UploadAlreadyCompletedException();
    }
    return video;
  }

  private async createDraft(
    channelId: string,
    dto: StartUploadDto,
  ): Promise<Video & { upload_id: string | null }> {
    for (let attempt = 1; attempt <= PUBLIC_ID_MAX_ATTEMPTS; attempt++) {
      const publicId = generatePublicId();
      try {
        return await this.videos.save(
          this.videos.create({
            public_id: publicId,
            channel_id: channelId,
            status: VideoStatus.UPLOADING,
            original_filename: dto.filename,
            size_bytes: dto.size_bytes,
            storage_key: `videos/${publicId}/original`,
          }),
        );
      } catch (error) {
        if (!isPublicIdCollision(error)) throw error;
      }
    }
    throw new Error('Could not generate a unique public_id');
  }
}
