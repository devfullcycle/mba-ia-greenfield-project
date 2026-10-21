import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { QUEUES } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/videos.constants';
import {
  UPLOAD_INACTIVITY_LIMIT_MS,
  UPLOAD_REAP_BATCH_SIZE,
  UPLOAD_REAP_CRON,
} from './worker.constants';

function isNoSuchUpload(error: unknown): boolean {
  const { name, $metadata } = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return name === 'NoSuchUpload' || $metadata?.httpStatusCode === 404;
}

@Injectable()
export class UploadReaperHandler implements OnApplicationBootstrap {
  private readonly logger = new Logger(UploadReaperHandler.name);

  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work(QUEUES.VIDEO_UPLOAD_REAP, async () => {
      await this.reap();
    });
    await this.queue.schedule(QUEUES.VIDEO_UPLOAD_REAP, UPLOAD_REAP_CRON);
  }

  /**
   * Removes videos whose multipart upload was left open past the inactivity
   * limit. Safe to rerun: an already-aborted upload is not an error, and a
   * failure on one video is logged and retried by the next run.
   */
  async reap(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - UPLOAD_INACTIVITY_LIMIT_MS);
    const abandoned = await this.videos.find({
      where: {
        status: VideoStatus.UPLOADING,
        upload_id: Not(IsNull()),
        updated_at: LessThan(cutoff),
      },
      take: UPLOAD_REAP_BATCH_SIZE,
    });

    let reaped = 0;
    for (const video of abandoned) {
      try {
        await this.reapOne(video);
        reaped++;
      } catch (error) {
        this.logger.error(
          `Could not reap upload of ${video.public_id}: ${(error as Error).message}`,
        );
      }
    }
    if (reaped > 0) this.logger.log(`Reaped ${reaped} abandoned upload(s)`);
    return reaped;
  }

  private async reapOne(video: Video): Promise<void> {
    try {
      // Aborting also discards the uploaded parts, so no partial object is left.
      await this.storage.abortMultipartUpload(
        video.storage_key,
        video.upload_id as string,
      );
    } catch (error) {
      if (!isNoSuchUpload(error)) throw error;
    }
    // Conditional: an upload completed meanwhile is no longer `uploading`.
    await this.videos.delete({
      id: video.id,
      status: VideoStatus.UPLOADING,
      upload_id: video.upload_id as string,
    });
  }
}
