import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import { Repository } from 'typeorm';
import {
  PROCESS_VIDEO_JOB,
  SWEEP_STALE_UPLOADS_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';
import type { ProcessVideoJobData } from '../queue/video-processing.producer';
import { StorageService } from '../storage/storage.service';
import { Video } from '../videos/entities/video.entity';
import { ProcessingStatus } from '../videos/video.enums';
import { thumbnailKey } from '../videos/videos.constants';
import {
  MediaProbeService,
  thumbnailTimestamp,
  type MediaProbeResult,
} from './media-probe.service';
import { StaleUploadSweeper } from './stale-upload.sweeper';
import {
  FAILURE_REASON_MAX_LENGTH,
  THUMBNAIL_CONTENT_TYPE,
} from './worker.constants';

interface Analysis {
  probe: MediaProbeResult;
  thumbnailPath: string;
}

@Processor(VIDEO_PROCESSING_QUEUE)
@Injectable()
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly mediaProbeService: MediaProbeService,
    private readonly staleUploadSweeper: StaleUploadSweeper,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    switch (job.name) {
      case PROCESS_VIDEO_JOB:
        await this.processVideo(job.data.videoId);
        return;
      case SWEEP_STALE_UPLOADS_JOB:
        await this.staleUploadSweeper.sweep();
        return;
      default:
        throw new Error(`Unsupported job "${job.name}"`);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ProcessVideoJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job || job.name !== PROCESS_VIDEO_JOB) {
      return;
    }
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      this.logger.warn(
        `process-video ${job.data.videoId} failed (attempt ${job.attemptsMade}/${maxAttempts}): ${error.message}`,
      );
      return;
    }

    const failureReason = error.message.slice(0, FAILURE_REASON_MAX_LENGTH);
    const result = await this.videoRepository.update(
      { id: job.data.videoId, processingStatus: ProcessingStatus.PROCESSING },
      { processingStatus: ProcessingStatus.FAILED, failureReason },
    );
    this.logger.error(
      `process-video ${job.data.videoId} failed for good: ${failureReason} (rows updated: ${result.affected ?? 0})`,
    );
  }

  private async processVideo(videoId: string): Promise<void> {
    const video = await this.videoRepository.findOneBy({ id: videoId });
    if (!video) {
      this.logger.warn(`process-video: video ${videoId} no longer exists`);
      return;
    }
    if (video.processingStatus !== ProcessingStatus.PROCESSING) {
      this.logger.log(
        `process-video: video ${videoId} is ${video.processingStatus}, nothing to do`,
      );
      return;
    }

    const workDir = await mkdtemp(join(tmpdir(), 'video-'));
    try {
      const { probe, thumbnailPath } = await this.analyze(video, workDir);

      await this.storageService.putObject(
        thumbnailKey(video.id),
        await readFile(thumbnailPath),
        THUMBNAIL_CONTENT_TYPE,
      );

      video.durationSeconds = String(probe.durationSeconds);
      video.metadata = probe.metadata as unknown as Record<string, unknown>;
      video.failureReason = null;
      video.processingStatus = ProcessingStatus.READY;
      await this.videoRepository.save(video);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Reads the object through a presigned URL first (no local copy of up to
   * 10GB); if that fails, downloads it to a temp file and retries on disk.
   */
  private async analyze(video: Video, workDir: string): Promise<Analysis> {
    const url = await this.storageService.presignGetInternal(video.objectKey);
    try {
      return await this.analyzeInput(url, join(workDir, 'thumbnail.jpg'));
    } catch (urlError) {
      this.logger.warn(
        `process-video ${video.id}: reading the presigned URL failed (${
          urlError instanceof Error ? urlError.message : String(urlError)
        }); falling back to a local copy`,
      );
    }

    const localPath = join(workDir, 'original');
    await this.storageService.getObjectToFile(video.objectKey, localPath);
    return this.analyzeInput(localPath, join(workDir, 'thumbnail.jpg'));
  }

  private async analyzeInput(
    input: string,
    thumbnailPath: string,
  ): Promise<Analysis> {
    const probe = await this.mediaProbeService.probe(input);
    await this.mediaProbeService.extractThumbnail(
      input,
      thumbnailTimestamp(probe.durationSeconds),
      thumbnailPath,
    );
    return { probe, thumbnailPath };
  }
}
