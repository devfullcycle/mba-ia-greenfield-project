import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { ConfigType } from '@nestjs/config';
import type { Job } from 'bullmq';
import { createWriteStream } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Repository } from 'typeorm';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import { VIDEO_QUEUE, type ProcessVideoJobData } from '../queue/video-jobs';
import { Video } from './entities/video.entity';
import { assertTransition, VideoStatus } from './video-status';
import { FfmpegService } from './services/ffmpeg.service';

const CONCURRENCY = Number(process.env.VIDEO_PROCESSING_CONCURRENCY ?? '2');

/**
 * Consumes the video-processing queue (in the worker container). For each job:
 * downloads the source, extracts duration/metadata, generates a thumbnail,
 * uploads it, and flips the video to `ready`. Exhausted retries mark `error`.
 */
@Processor(VIDEO_QUEUE, { concurrency: CONCURRENCY })
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    const { videoId } = job.data;
    const video = await this.videos.findOneBy({ id: videoId });
    if (!video) {
      this.logger.warn(`Video ${videoId} not found; skipping job`);
      return;
    }
    if (video.status !== VideoStatus.PROCESSING) {
      this.logger.warn(
        `Video ${videoId} is "${video.status}", not "processing"; skipping`,
      );
      return;
    }

    const sourcePath = join(tmpdir(), `${videoId}-source`);
    const thumbPath = join(tmpdir(), `${videoId}-thumb.jpg`);

    try {
      const obj = await this.storage.getObjectRange(video.storage_key);
      await pipeline(obj.stream, createWriteStream(sourcePath));

      const { durationSeconds, metadata } = await this.ffmpeg.probe(sourcePath);
      // Clamp the thumbnail timestamp inside the clip — seeking past the last
      // frame (e.g. a 1s clip with a 1s default) yields no output frame.
      const thumbAt =
        durationSeconds > this.config.thumbnailTimestampSeconds
          ? this.config.thumbnailTimestampSeconds
          : 0;
      await this.ffmpeg.extractThumbnail(sourcePath, thumbPath, thumbAt);

      const thumbnailKey = `videos/${video.public_id}/thumbnail.jpg`;
      const thumbnail = await readFile(thumbPath);
      await this.storage.putObject(thumbnailKey, thumbnail, 'image/jpeg');

      assertTransition(video.status, VideoStatus.READY);
      video.status = VideoStatus.READY;
      video.duration_seconds = durationSeconds;
      video.metadata = metadata;
      video.thumbnail_key = thumbnailKey;
      await this.videos.save(video);

      this.logger.log(
        `Video ${videoId} processed (duration=${durationSeconds}s)`,
      );
    } finally {
      await Promise.allSettled([unlink(sourcePath), unlink(thumbPath)]);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProcessVideoJobData>): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      // retries remain; leave the video in "processing"
      return;
    }
    const { videoId } = job.data;
    const video = await this.videos.findOneBy({ id: videoId });
    if (!video || video.status !== VideoStatus.PROCESSING) {
      return;
    }
    video.status = VideoStatus.ERROR;
    video.failure_reason = job.failedReason ?? 'processing failed';
    await this.videos.save(video);
    this.logger.error(
      `Video ${videoId} marked as error: ${video.failure_reason}`,
    );
  }
}
