import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { QUEUES, type VideoProcessPayload } from '../queue/queue.constants';
import { JobContext, QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/videos.constants';
import { FfmpegService, thumbnailInstant } from './ffmpeg.service';

const SOURCE_URL_EXPIRES_IN_SECONDS = 3600;

@Injectable()
export class VideoProcessingHandler implements OnApplicationBootstrap {
  private readonly logger = new Logger(VideoProcessingHandler.name);

  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
    private readonly queue: QueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work<VideoProcessPayload>(QUEUES.VIDEO_PROCESS, (job) =>
      this.handle(job),
    );
  }

  /**
   * Delivery is at-least-once: only a video still in `processing` is worked on,
   * so redelivering a finished job changes nothing.
   */
  async handle(job: JobContext<VideoProcessPayload>): Promise<void> {
    const video = await this.videos.findOne({
      where: { id: job.data.videoId },
    });
    if (!video) {
      this.logger.warn(`Video ${job.data.videoId} not found, dropping job`);
      return;
    }
    if (video.status !== VideoStatus.PROCESSING) {
      this.logger.log(`Video ${video.public_id} is ${video.status}, skipping`);
      return;
    }

    try {
      await this.process(video);
    } catch (error) {
      if (job.retryCount >= job.retryLimit) {
        await this.videos.update(
          { id: video.id, status: VideoStatus.PROCESSING },
          { status: VideoStatus.FAILED },
        );
        this.logger.error(
          `Video ${video.public_id} failed for good: ${(error as Error).message}`,
        );
      }
      throw error;
    }
  }

  private async process(video: Video): Promise<void> {
    const url = await this.storage.presignInternalGetUrl(
      video.storage_key,
      SOURCE_URL_EXPIRES_IN_SECONDS,
    );
    const { durationSeconds, metadata } = await this.ffmpeg.probe(url);
    const thumbnail = await this.ffmpeg.extractThumbnail(
      url,
      thumbnailInstant(durationSeconds),
    );
    // Deterministic key: a duplicate delivery overwrites instead of adding a second object.
    const thumbnailKey = `videos/${video.public_id}/thumbnail.jpg`;
    await this.storage.putObject(thumbnailKey, thumbnail, 'image/jpeg');

    await this.videos.update(
      { id: video.id, status: VideoStatus.PROCESSING },
      {
        duration_seconds: durationSeconds,
        metadata: metadata as QueryDeepPartialEntity<Video>['metadata'],
        thumbnail_key: thumbnailKey,
        status: VideoStatus.READY,
      },
    );
  }
}
