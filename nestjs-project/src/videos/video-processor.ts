import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { Video } from './entities/video.entity';
import { FfmpegService } from './processing/ffmpeg.service';
import {
  PROCESS_VIDEO_JOB,
  ProcessVideoJobData,
  storageKey,
  VIDEO_PROCESSING_QUEUE,
  VideoStatus,
} from './videos.constants';

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    if (job.name !== PROCESS_VIDEO_JOB) {
      return;
    }

    const { videoId } = job.data;
    const video = await this.videos.findOne({ where: { id: videoId } });

    if (!video) {
      this.logger.warn(`Video ${videoId} not found; skipping`);
      return;
    }
    if (video.status === VideoStatus.READY) {
      this.logger.log(`Video ${videoId} already ready; skipping (idempotent)`);
      return;
    }
    if (!video.storage_key) {
      throw new Error(`Video ${videoId} has no storage_key`);
    }

    const workDir = await mkdtemp(join(tmpdir(), 'streamtube-video-'));
    const inputPath = join(workDir, 'input');
    const thumbnailPath = join(workDir, 'thumbnail.jpg');

    try {
      const { stream } = await this.storage.getObjectRange(video.storage_key);
      await pipeline(stream, createWriteStream(inputPath));

      const metadata = await this.ffmpeg.extractMetadata(inputPath);
      const thumbnailTs = metadata.durationSeconds > 1 ? 1 : 0;
      await this.ffmpeg.generateThumbnail(
        inputPath,
        thumbnailPath,
        thumbnailTs,
      );

      const thumbnailKey = storageKey.thumbnail(video.id);
      await this.storage.putObject(
        thumbnailKey,
        await readFile(thumbnailPath),
        'image/jpeg',
      );

      video.duration_seconds = metadata.durationSeconds;
      video.metadata = {
        width: metadata.width,
        height: metadata.height,
        codec: metadata.codec,
        bitrate: metadata.bitrate,
      };
      video.thumbnail_key = thumbnailKey;
      video.status = VideoStatus.READY;
      video.error_reason = null;
      await this.videos.save(video);

      this.logger.log(`Video ${videoId} processed successfully`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProcessVideoJobData>, error: Error): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      // transient failure — BullMQ will retry
      return;
    }

    const video = await this.videos.findOne({
      where: { id: job.data.videoId },
    });
    if (video && video.status !== VideoStatus.READY) {
      video.status = VideoStatus.ERROR;
      video.error_reason = (error.message ?? 'processing failed').slice(
        0,
        1000,
      );
      await this.videos.save(video);
      this.logger.error(
        `Video ${job.data.videoId} failed permanently: ${error.message}`,
      );
    }
  }
}
