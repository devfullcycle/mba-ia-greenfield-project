import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { customAlphabet } from 'nanoid';
import { Repository } from 'typeorm';
import {
  InvalidVideoStateException,
  StorageUploadFailedException,
  VideoAccessDeniedException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { Channel } from '../channels/entities/channel.entity';
import { ChannelsService } from '../channels/channels.service';
import storageConfig from '../config/storage.config';
import type { ConfigType } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { InitUploadDto } from './dto/init-upload.dto';
import { Video, VideoStatus } from './entities/video.entity';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
  VideoJobData,
} from './video-job.types';

const URL_CODE_LENGTH = 12;
const URL_CODE_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const generateUrlCode = customAlphabet(URL_CODE_ALPHABET, URL_CODE_LENGTH);

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly videoProcessingQueue: Queue<VideoJobData>,
  ) {}

  private async getChannelByUserId(userId: string): Promise<Channel> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new VideoAccessDeniedException();
    }
    return channel;
  }

  private async getVideoByUrlCode(urlCode: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { url_code: urlCode },
      relations: ['channel'],
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  private assertStreamable(video: Video): void {
    if (
      video.status !== VideoStatus.READY &&
      video.status !== VideoStatus.PROCESSING
    ) {
      throw new VideoNotReadyException();
    }
  }

  async uploadInit(
    userId: string,
    dto: InitUploadDto,
  ): Promise<{
    videoId: string;
    urlCode: string;
    uploadUrl: string;
    storageKey: string;
  }> {
    const channel = await this.getChannelByUserId(userId);
    const urlCode = generateUrlCode();
    const storageKey = `raw-videos/${urlCode}-${dto.originalFilename}`;

    const video = await this.videoRepository.save(
      this.videoRepository.create({
        url_code: urlCode,
        title: dto.title,
        description: dto.description ?? null,
        status: VideoStatus.DRAFT,
        channel_id: channel.id,
        original_filename: dto.originalFilename,
        storage_key: storageKey,
        size_bytes: dto.sizeBytes ?? null,
      }),
    );

    const uploadUrl = await this.storageService.getPresignedUploadUrl(
      this.config.bucketVideos,
      storageKey,
    );

    return {
      videoId: video.id,
      urlCode: video.url_code,
      uploadUrl,
      storageKey,
    };
  }

  async uploadComplete(
    userId: string,
    urlCode: string,
  ): Promise<{
    id: string;
    urlCode: string;
    title: string;
    status: VideoStatus;
    createdAt: Date;
  }> {
    const [video, channel] = await Promise.all([
      this.getVideoByUrlCode(urlCode),
      this.getChannelByUserId(userId),
    ]);

    if (video.channel_id !== channel.id) {
      throw new VideoAccessDeniedException();
    }
    if (video.status !== VideoStatus.DRAFT) {
      throw new InvalidVideoStateException();
    }

    try {
      await this.storageService.headObject(
        this.config.bucketVideos,
        video.storage_key!,
      );
    } catch {
      throw new StorageUploadFailedException();
    }

    video.status = VideoStatus.PROCESSING;
    const updated = await this.videoRepository.save(video);

    await this.videoProcessingQueue.add(
      PROCESS_VIDEO_JOB,
      {
        videoId: updated.id,
        urlCode: updated.url_code,
        storageKey: updated.storage_key!,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    return {
      id: updated.id,
      urlCode: updated.url_code,
      title: updated.title,
      status: updated.status,
      createdAt: updated.created_at,
    };
  }

  async getByUrlCode(urlCode: string): Promise<{
    id: string;
    urlCode: string;
    title: string;
    description: string | null;
    status: VideoStatus;
    durationSeconds: number | null;
    thumbnailUrl: string | null;
    resolutionWidth: number | null;
    resolutionHeight: number | null;
    codec: string | null;
    channel: { id: string; name: string; nickname: string };
    createdAt: Date;
  }> {
    const video = await this.getVideoByUrlCode(urlCode);

    const thumbnailUrl = video.thumbnail_key
      ? await this.storageService.getPresignedDownloadUrl(
          this.config.bucketThumbnails,
          video.thumbnail_key,
        )
      : null;

    return {
      id: video.id,
      urlCode: video.url_code,
      title: video.title,
      description: video.description,
      status: video.status,
      durationSeconds: video.duration_seconds,
      thumbnailUrl,
      resolutionWidth: video.resolution_width,
      resolutionHeight: video.resolution_height,
      codec: video.codec,
      channel: {
        id: video.channel.id,
        name: video.channel.name,
        nickname: video.channel.nickname,
      },
      createdAt: video.created_at,
    };
  }

  async stream(
    urlCode: string,
    rangeHeader: string | undefined,
  ): Promise<{
    stream: NodeJS.ReadableStream;
    status: number;
    headers: Record<string, string>;
  }> {
    const video = await this.getVideoByUrlCode(urlCode);
    this.assertStreamable(video);

    const object = await this.storageService.getObjectStream(
      this.config.bucketVideos,
      video.storage_key!,
      rangeHeader,
    );

    const headers: Record<string, string> = {
      'Content-Type': object.contentType || 'video/mp4',
      'Accept-Ranges': object.acceptRanges,
    };
    if (object.contentLength !== undefined) {
      headers['Content-Length'] = String(object.contentLength);
    }
    if (object.contentRange) {
      headers['Content-Range'] = object.contentRange;
    }

    return {
      stream: object.stream,
      status: object.contentRange ? 206 : 200,
      headers,
    };
  }

  async download(urlCode: string): Promise<string> {
    const video = await this.getVideoByUrlCode(urlCode);
    this.assertStreamable(video);

    return this.storageService.getPresignedDownloadUrl(
      this.config.bucketVideos,
      video.storage_key!,
      video.original_filename,
    );
  }
}
