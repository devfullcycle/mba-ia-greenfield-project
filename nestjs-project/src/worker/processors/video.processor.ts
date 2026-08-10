import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from '../../queue/queue.constants';
import type { ProcessVideoPayload } from '../../queue/video-queue.service';
import { StorageService } from '../../storage/storage.service';
import { VideosService } from '../../videos/videos.service';
import { generateThumbnail, parseFrameRate, probeVideo } from '../ffmpeg.util';

@Processor(QUEUES.VIDEO_PROCESSING)
@Injectable()
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly videosService: VideosService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoPayload>): Promise<void> {
    const { videoId, storageKey, slug } = job.data;

    const { url } = await this.storageService.generatePresignedGetUrl(
      storageKey,
      3600,
    );

    const probed = await probeVideo(url);
    const durationSeconds = Math.round(probed.format.duration ?? 0);
    const videoStream = probed.streams.find(
      (stream) => stream.codec_type === 'video',
    );

    const thumbnailBuffer = await generateThumbnail(url, durationSeconds * 0.5);
    const thumbnailKey = `videos/${slug}/thumbnail.jpg`;
    await this.storageService.uploadObject(
      thumbnailKey,
      thumbnailBuffer,
      'image/jpeg',
    );

    await this.videosService.markProcessingReady(videoId, {
      duration_seconds: durationSeconds,
      thumbnail_key: thumbnailKey,
      metadata: {
        codec: videoStream?.codec_name ?? null,
        resolution: videoStream
          ? `${videoStream.width}x${videoStream.height}`
          : null,
        bitrate:
          probed.format.bit_rate != null
            ? Number(probed.format.bit_rate)
            : null,
        fps: parseFrameRate(videoStream?.r_frame_rate),
      },
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ProcessVideoPayload> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) {
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      return;
    }

    this.logger.error(
      `Video ${job.data.videoId} processing failed after ${job.attemptsMade} attempts: ${error.message}`,
    );
    await this.videosService.markProcessingError(
      job.data.videoId,
      error.message,
    );
  }
}
