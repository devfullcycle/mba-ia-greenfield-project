import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { createWriteStream } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Repository } from 'typeorm';
import { StorageService } from '../../storage/storage.service';
import { Video, VideoStatus } from '../entities/video.entity';
import { PROCESS_VIDEO_JOB, VIDEO_PROCESSING_QUEUE } from '../videos.service';
import { MediaProbeService } from './media-probe.service';

export interface ProcessVideoJobPayload {
  videoId: string;
  storageKey: string;
}

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly mediaProbeService: MediaProbeService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobPayload, void, string>): Promise<void> {
    if (job.name !== PROCESS_VIDEO_JOB && job.name !== '__default__') {
      throw new Error(`Unsupported job name: ${job.name}`);
    }

    const { videoId, storageKey } = job.data;
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      this.logger.warn(`Video ${videoId} no longer exists; skipping job`);
      return;
    }

    const uniqueSuffix = `${videoId}-${Date.now()}`;
    const tempVideoPath = join(
      tmpdir(),
      `streamtube-video-${uniqueSuffix}.mp4`,
    );
    const tempThumbPath = join(
      tmpdir(),
      `streamtube-thumb-${uniqueSuffix}.jpg`,
    );

    try {
      const { stream } = await this.storageService.getObjectStream(storageKey);
      await pipeline(stream, createWriteStream(tempVideoPath));

      const metadata =
        await this.mediaProbeService.extractMetadata(tempVideoPath);

      await this.mediaProbeService.generateThumbnail(
        tempVideoPath,
        tempThumbPath,
        metadata.durationSeconds,
      );

      const thumbnailBuffer = await readFile(tempThumbPath);
      const thumbnailKey = `thumbnails/${videoId}/thumb.jpg`;
      await this.storageService.putObject(
        thumbnailKey,
        thumbnailBuffer,
        'image/jpeg',
      );

      video.status = VideoStatus.READY;
      video.duration_seconds = metadata.durationSeconds;
      video.width = metadata.width;
      video.height = metadata.height;
      video.codec = metadata.codec;
      video.thumbnail_key = thumbnailKey;
      video.processing_error = null;
      await this.videoRepository.save(video);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const maxAttempts = job.opts?.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

      video.processing_error = errorMessage;
      if (isFinalAttempt) {
        video.status = VideoStatus.FAILED;
      }
      await this.videoRepository.save(video);

      throw error;
    } finally {
      await unlink(tempVideoPath).catch(() => undefined);
      await unlink(tempThumbPath).catch(() => undefined);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ProcessVideoJobPayload> | undefined, error: Error): void {
    if (!job) return;
    this.logger.error(
      `Job ${job.id} for video ${job.data.videoId} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? 1}): ${error.message}`,
    );
  }
}
