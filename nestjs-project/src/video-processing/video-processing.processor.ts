import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import * as ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { Video } from '../videos/entities/video.entity';
import { StorageService } from '../storage/storage.service';
import {
  VideoStatus,
  VIDEO_QUEUE_NAME,
  type VideoProcessingJob,
} from '../videos/videos.constants';

interface FfprobeMetadata {
  duration: number;
  width: number;
  height: number;
  codec: string;
  bitrate_kbps: number;
}

ffmpeg.setFfprobePath(ffprobeInstaller.path);

@Processor(VIDEO_QUEUE_NAME, { lockDuration: 300_000 })
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  override async process(job: Job<VideoProcessingJob>): Promise<void> {
    const { videoId, storageKey } = job.data;
    const tmpDir = `/tmp/${videoId}`;
    const videoPath = path.join(tmpDir, 'original');
    const thumbPath = path.join(tmpDir, 'thumbnail.jpg');

    try {
      const video = await this.videoRepository.findOne({
        where: { id: videoId },
      });
      if (!video) {
        this.logger.warn(`Video ${videoId} not found — discarding job`);
        return;
      }

      if (video.status !== VideoStatus.PROCESSING) {
        this.logger.warn(
          `Video ${videoId} status is ${video.status} — discarding (idempotency)`,
        );
        return;
      }

      fs.mkdirSync(tmpDir, { recursive: true });

      // Download video from storage
      const { stream } = await this.storageService.getObject(storageKey);
      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(videoPath);
        stream.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        stream.on('error', reject);
      });

      // Extract metadata via ffprobe
      const metadata = await this.extractMetadata(videoPath);

      // Generate thumbnail
      await this.generateThumbnail(videoPath, thumbPath);

      // Upload thumbnail to storage
      const thumbnailKey = `videos/${videoId}/thumbnail.jpg`;
      const thumbBuffer = fs.readFileSync(thumbPath);
      await this.storageService.putObject(
        thumbnailKey,
        thumbBuffer,
        'image/jpeg',
      );

      // Update DB with success
      await this.videoRepository.update(videoId, {
        status: VideoStatus.READY,
        thumbnail_key: thumbnailKey,
        duration_seconds: Math.floor(metadata.duration),
        processing_metadata: {
          width: metadata.width,
          height: metadata.height,
          codec: metadata.codec,
          bitrate_kbps: metadata.bitrate_kbps,
        },
        error_cause: null,
      });

      this.logger.log(`Video ${videoId} processed successfully`);
    } catch (err: unknown) {
      const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1) - 1;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';

      if (isLastAttempt) {
        await this.videoRepository
          .update(videoId, {
            status: VideoStatus.ERROR,
            error_cause: errorMessage.slice(0, 2048),
          })
          .catch((dbErr) => {
            this.logger.error(
              `Failed to update video ${videoId} to error status`,
              dbErr,
            );
          });
        this.logger.error(
          `Video ${videoId} failed permanently after ${job.attemptsMade + 1} attempts: ${errorMessage}`,
        );
      } else {
        this.logger.warn(
          `Video ${videoId} processing attempt ${job.attemptsMade + 1} failed: ${errorMessage} — retrying`,
        );
      }

      throw err;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private extractMetadata(videoPath: string): Promise<FfprobeMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, data) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        const videoStream = data.streams.find((s) => s.codec_type === 'video');
        const format = data.format;
        resolve({
          duration: format.duration ?? 0,
          width: videoStream?.width ?? 0,
          height: videoStream?.height ?? 0,
          codec: videoStream?.codec_name ?? 'unknown',
          bitrate_kbps: Math.floor((format.bit_rate ?? 0) / 1000),
        });
      });
    });
  }

  private generateThumbnail(
    videoPath: string,
    outputPath: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: ['00:00:01'],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: '1280x?',
        })
        .on('end', () => resolve())
        .on('error', reject);
    });
  }
}
