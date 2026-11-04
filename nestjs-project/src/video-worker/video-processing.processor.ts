import {
  Inject,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Repository } from 'typeorm';
import storageConfig from '../config/storage.config';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';
import type { VideoProcessingJob } from '../queue/jobs/video-processing.job';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { FfmpegService } from './services/ffmpeg.service';

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  onApplicationBootstrap(): void {
    try {
      this.worker.on('error', (err) => {
        this.logger.warn(`BullMQ worker error: ${err.message}`);
      });
    } catch {
      // Worker might not be initialized
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.worker.close();
    } catch {
      // Ignored during shutdown
    }
  }

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly ffmpegService: FfmpegService,
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
  ) {
    super();
  }

  async process(job: Job<VideoProcessingJob>): Promise<void> {
    if (job.name !== PROCESS_VIDEO_JOB) {
      return;
    }

    const { videoId, storageKey, bucket } = job.data;
    const workDir = await mkdtemp(join(tmpdir(), 'streamtube-video-'));
    const inputPath = join(workDir, `source${extname(storageKey) || '.mp4'}`);
    const thumbnailPath = join(workDir, 'thumbnail.jpg');

    try {
      const { stream } = await this.storageService.getObjectStream(
        storageKey,
        bucket,
      );
      await pipeline(stream, createWriteStream(inputPath));

      const metadata = await this.ffmpegService.extractMetadata(inputPath);
      const thumbnailTime = metadata.duration >= 5 ? 5 : 0;
      await this.ffmpegService.generateThumbnail(
        inputPath,
        thumbnailPath,
        thumbnailTime,
      );

      const thumbnailKey = `thumbnails/${videoId}/thumbnail.jpg`;
      await this.storageService.uploadStream(
        thumbnailKey,
        createReadStream(thumbnailPath),
        'image/jpeg',
        this.storageCfg.bucketThumbnails,
      );

      await this.videoRepository.update(
        { id: videoId },
        {
          status: VideoStatus.READY,
          duration_seconds: metadata.duration,
          thumbnail_key: thumbnailKey,
          error_message: null,
        },
      );

      this.logger.log(`Video ${videoId} processed successfully`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown processing error';

      await this.videoRepository.update(
        { id: videoId },
        {
          status: VideoStatus.ERROR,
          error_message: message,
        },
      );

      this.logger.error(`Failed to process video ${videoId}: ${message}`);
      throw error;
    } finally {
      await rm(workDir, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}
