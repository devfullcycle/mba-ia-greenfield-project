import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { pipeline } from 'stream/promises';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import type { Job } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStaticImport from 'ffmpeg-static';
import ffprobeStaticImport from 'ffprobe-static';
import { Video } from '../../../nestjs-project/src/videos/entities/video.entity';
import { StorageService } from '../../../nestjs-project/src/storage/storage.service';
import {
  ProcessVideoJobData,
  VIDEO_PROCESSING_QUEUE,
} from '../../../nestjs-project/src/videos/interfaces/process-video-job.interface';

const ffmpegStaticPath = ffmpegStaticImport as unknown as string | null;
const ffprobeStaticPath = (ffprobeStaticImport as unknown as { path: string })
  .path;

if (ffmpegStaticPath) {
  ffmpeg.setFfmpegPath(ffmpegStaticPath);
}
ffmpeg.setFfprobePath(ffprobeStaticPath);

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      resolve(data.format.duration ?? 0);
    });
  });
}

function generateThumbnail(
  filePath: string,
  folder: string,
  filename: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .screenshots({ count: 1, timemarks: ['10%'], filename, folder });
  });
}

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessorService extends WorkerHost {
  private readonly logger = new Logger(VideoProcessorService.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    const video = await this.videoRepository.findOneBy({
      id: job.data.videoId,
    });
    if (!video) {
      this.logger.warn(
        `Received processing job for unknown videoId=${job.data.videoId}`,
      );
      return;
    }

    await this.processVideo(video);
  }

  private async processVideo(video: Video): Promise<void> {
    this.logger.log(`Processing videoId=${video.id}`);

    const tempDir = os.tmpdir();
    const originalPath = path.join(tempDir, `${video.id}-original`);
    const thumbnailFilename = `${video.id}-thumbnail.jpg`;
    const thumbnailPath = path.join(tempDir, thumbnailFilename);

    try {
      const originalStream = await this.storageService.getObjectStream(
        video.storage_key,
      );
      await pipeline(originalStream, fs.createWriteStream(originalPath));

      const durationSeconds = await probeDuration(originalPath);
      await generateThumbnail(originalPath, tempDir, thumbnailFilename);

      const thumbnailBuffer = await fs.promises.readFile(thumbnailPath);
      const thumbnailKey = `videos/${video.id}/thumbnail.jpg`;
      await this.storageService.putObject(
        thumbnailKey,
        thumbnailBuffer,
        'image/jpeg',
      );

      video.status = 'ready';
      video.duration_seconds = durationSeconds;
      video.thumbnail_key = thumbnailKey;
      await this.videoRepository.save(video);

      this.logger.log(`Finished processing videoId=${video.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to process videoId=${video.id}: ${(error as Error).stack ?? String(error)}`,
      );
      video.status = 'failed';
      video.failure_reason = sanitizeFailureReason(error);
      await this.videoRepository.save(video);
    } finally {
      await Promise.all([
        fs.promises.rm(originalPath, { force: true }),
        fs.promises.rm(thumbnailPath, { force: true }),
      ]);
    }
  }
}

const MAX_FAILURE_REASON_LENGTH = 500;

function sanitizeFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_FAILURE_REASON_LENGTH);
}
