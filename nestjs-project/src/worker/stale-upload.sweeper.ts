import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { Video } from '../videos/entities/video.entity';
import { ProcessingStatus } from '../videos/video.enums';
import {
  STALE_UPLOAD_FAILURE_REASON,
  STALE_UPLOAD_MAX_AGE_MS,
} from './worker.constants';

export interface SweepResult {
  swept: number;
  skipped: number;
}

/**
 * Fails uploads that were started but never completed (the client vanished
 * before calling `complete`) and releases their multipart upload in storage.
 */
@Injectable()
export class StaleUploadSweeper {
  private readonly logger = new Logger(StaleUploadSweeper.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
  ) {}

  async sweep(now: Date = new Date()): Promise<SweepResult> {
    const cutoff = new Date(now.getTime() - STALE_UPLOAD_MAX_AGE_MS);
    const staleVideos = await this.videoRepository.find({
      where: {
        processingStatus: ProcessingStatus.UPLOADING,
        updatedAt: LessThan(cutoff),
      },
    });

    let swept = 0;
    let skipped = 0;
    for (const video of staleVideos) {
      // Background job: one bad video must not stop the others, and it must be
      // retried by the next run, so it stays UPLOADING (its multipart upload
      // is still open and would be orphaned if we marked it FAILED now).
      try {
        await this.failStaleUpload(video);
        swept++;
      } catch (error) {
        skipped++;
        this.logger.error(
          `Could not sweep video ${video.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (staleVideos.length > 0) {
      this.logger.log(
        `Stale upload sweep: ${swept} failed, ${skipped} left for the next run`,
      );
    }
    return { swept, skipped };
  }

  private async failStaleUpload(video: Video): Promise<void> {
    if (video.uploadId) {
      await this.storageService.abortMultipartUpload(
        video.objectKey,
        video.uploadId,
      );
    }
    video.processingStatus = ProcessingStatus.FAILED;
    video.failureReason = STALE_UPLOAD_FAILURE_REASON;
    video.uploadId = null;
    await this.videoRepository.save(video);
  }
}
