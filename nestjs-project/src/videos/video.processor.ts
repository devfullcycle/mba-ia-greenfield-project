import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { Repository } from 'typeorm';
import { StorageService } from './storage.service';
import { Video, VideoStatus } from './video.entity';
import { VIDEO_PROCESSING_QUEUE } from './videos.constants';

const THUMBNAIL_FILENAME = 'thumbnail.png';

interface ProcessVideoJobData {
  videoId: string;
}

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    const video = await this.videoRepository.findOneByOrFail({
      id: job.data.videoId,
    });
    video.status = VideoStatus.PROCESSING;
    await this.videoRepository.save(video);

    const workDir = await mkdtemp(join(tmpdir(), 'video-processing-'));
    const localFilePath = join(
      workDir,
      `original${extname(video.storage_key)}`,
    );

    try {
      await this.storageService.downloadToFile(
        video.storage_key,
        localFilePath,
      );
      const durationSeconds = await this.extractDuration(localFilePath);
      await this.generateThumbnail(localFilePath, workDir);

      const thumbnailKey = `videos/${video.channel_id}/${video.id}/${THUMBNAIL_FILENAME}`;
      await this.storageService.uploadFile(
        thumbnailKey,
        join(workDir, THUMBNAIL_FILENAME),
        'image/png',
      );

      video.status = VideoStatus.READY;
      video.duration_seconds = Math.round(durationSeconds);
      video.thumbnail_key = thumbnailKey;
      await this.videoRepository.save(video);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProcessVideoJobData> | undefined): Promise<void> {
    if (!job) {
      return;
    }
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      return;
    }

    this.logger.warn(
      `Video ${job.data.videoId} failed processing after ${job.attemptsMade} attempts: ${job.failedReason}`,
    );
    const failureReason = (
      job.failedReason ?? 'Unknown processing error'
    ).slice(0, 500);
    await this.videoRepository.update(job.data.videoId, {
      status: VideoStatus.FAILED,
      failure_reason: failureReason,
    });
  }

  private extractDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err: unknown, metadata) => {
        if (err) {
          reject(err instanceof Error ? err : new Error('ffprobe failed'));
          return;
        }
        resolve(metadata.format.duration ?? 0);
      });
    });
  }

  private generateThumbnail(filePath: string, folder: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .screenshots({
          timestamps: ['10%'],
          filename: THUMBNAIL_FILENAME,
          folder,
          size: '640x360',
        });
    });
  }
}
