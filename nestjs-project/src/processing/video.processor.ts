import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.constants';
import type { ProcessVideoJobData } from '../queue/video-processing.queue';
import { StorageService } from '../storage/storage.service';
import { videoThumbnailKey } from '../videos/videos.constants';
import { VideosRepository } from '../videos/videos.repository';
import { FfmpegService } from './ffmpeg.service';
import {
  classifyProcessingError,
  processingBackoff,
  thumbnailTimestamp,
} from './processing-policy';

/** Internal GET URL lifetime: long enough for ffprobe/ffmpeg on large files. */
const INTERNAL_URL_TTL_SECONDS = 60 * 60;

/**
 * Consumer of `process-video` (worker process only). At-least-once delivery,
 * so it is idempotent: anything not in PROCESSING is acknowledged untouched.
 */
@Processor(VIDEO_PROCESSING_QUEUE, {
  settings: { backoffStrategy: processingBackoff },
})
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    const { videoId } = job.data;
    const video = await this.videosRepository.findById(videoId);
    if (!video || video.status !== 'PROCESSING') {
      this.logger.log(`Skipping video ${videoId}: not PROCESSING`);
      return;
    }

    try {
      // Fails fast (as infra) when storage is unreachable, before ffprobe could
      // misreport it as an invalid file.
      await this.storage.headObject(video.storage_key);
      const url = await this.storage.presignInternalGet(
        video.storage_key,
        INTERNAL_URL_TTL_SECONDS,
      );
      const metadata = await this.ffmpeg.probe(url);
      const frame = await this.ffmpeg.extractFrame(
        url,
        thumbnailTimestamp(metadata.duration_seconds),
      );
      const thumbnailKey = videoThumbnailKey(video.id);
      await this.storage.putObject(thumbnailKey, frame, 'image/jpeg');
      await this.videosRepository.markReady(video.id, {
        ...metadata,
        thumbnail_key: thumbnailKey,
      });
    } catch (err) {
      await this.handleFailure(video.id, err);
    }
  }

  private async handleFailure(videoId: string, err: unknown): Promise<never> {
    const classification = classifyProcessingError(err);
    if (classification.kind === 'infra') {
      this.logger.warn(
        `Infra failure processing video ${videoId}; will retry: ${String(err)}`,
      );
      throw err;
    }

    // If ERROR cannot be persisted (DB down) this throws a normal error, so the
    // job is retried instead of being dropped as unrecoverable.
    await this.videosRepository.markError(videoId, classification.reason);
    this.logger.warn(
      `Video ${videoId} failed permanently: ${classification.reason}`,
    );
    throw new UnrecoverableError(classification.reason);
  }
}
