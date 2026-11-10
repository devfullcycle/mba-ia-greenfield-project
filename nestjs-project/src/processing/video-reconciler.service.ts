import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import videoConfig from '../config/video.config';
import { VideoProcessingQueue } from '../queue/video-processing.queue';
import type { Video } from '../videos/entities/video.entity';
import { VideosRepository } from '../videos/videos.repository';

export const STALE_PROCESSING_AFTER_MS = 15 * 60 * 1000;

/**
 * Safety net for lost enqueues (e.g. Redis down when an upload completed):
 * re-enqueues videos stuck in PROCESSING with no live job.
 */
@Injectable()
export class VideoReconcilerService {
  private readonly logger = new Logger(VideoReconcilerService.name);

  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly processingQueue: VideoProcessingQueue,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  @Cron('*/5 * * * *', { name: 'video-reconciler' })
  async handleCron(): Promise<void> {
    if (!this.config.reconcilerEnabled) return;
    await this.reconcile();
  }

  async findStaleProcessing(now: Date): Promise<Video[]> {
    return this.videosRepository.findStaleProcessing(
      new Date(now.getTime() - STALE_PROCESSING_AFTER_MS),
    );
  }

  /** Re-enqueues stale videos without an active job; returns how many were enqueued. */
  async reconcile(now: Date = new Date()): Promise<number> {
    const stale = await this.findStaleProcessing(now);
    let enqueued = 0;
    for (const video of stale) {
      try {
        if (await this.processingQueue.hasActiveJob(video.id)) continue;
        await this.processingQueue.enqueue(video.id);
        enqueued++;
      } catch (err) {
        // Cron context: log and let the next run retry (e.g. Redis still down).
        this.logger.error(
          `Could not re-enqueue video ${video.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    if (enqueued > 0) {
      this.logger.log(`Re-enqueued ${enqueued} stale video(s)`);
    }
    return enqueued;
  }
}
