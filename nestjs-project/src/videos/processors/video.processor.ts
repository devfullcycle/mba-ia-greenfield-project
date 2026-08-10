import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ConfigType } from '@nestjs/config';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { Video, VideoStatus } from '../entities/video.entity';
import { StorageService } from '../services/storage.service';
import storageConfig from '../../config/storage.config';

@Processor('video-processing')
@Injectable()
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
  ) {
    super();
  }

  async process(job: Job<{ videoId: string; videoKey: string }>): Promise<any> {
    const { videoId, videoKey } = job.data;
    this.logger.log(`Processing video ${videoId} (key: ${videoKey})`);

    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      this.logger.error(`Video ${videoId} not found in database`);
      throw new Error(`Video ${videoId} not found`);
    }

    const tempInputPath = path.join(os.tmpdir(), `${videoId}-input.mp4`);
    const tempThumbnailDir = os.tmpdir();
    const thumbnailFilename = `${videoId}-thumbnail.jpg`;
    const tempThumbnailPath = path.join(tempThumbnailDir, thumbnailFilename);

    try {
      // 1. Download video file from MinIO to temp file
      this.logger.log(`Downloading ${videoKey} to local temp path...`);
      const { stream } = await this.storageService.getObjectStream(
        this.storageCfg.bucketVideos,
        videoKey,
      );

      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(tempInputPath);
        stream.pipe(writeStream);
        writeStream.on('finish', () => resolve());
        writeStream.on('error', (err) => reject(err));
      });

      // 2. Probe metadata using ffprobe to get duration and format details
      this.logger.log(`Extracting duration and metadata with ffprobe...`);
      const { duration, metadataObj } = await new Promise<{
        duration: number;
        metadataObj: any;
      }>((resolve, reject) => {
        ffmpeg.ffprobe(tempInputPath, (err, metadata) => {
          if (err) {
            return reject(err instanceof Error ? err : new Error(String(err)));
          }
          resolve({
            duration: metadata?.format?.duration ?? 0,
            metadataObj: metadata ?? null,
          });
        });
      });
      this.logger.log(`Extracted duration: ${duration}s`);

      // 3. Extract thumbnail image using ffmpeg screenshots at 10% of duration
      this.logger.log(`Generating thumbnail with ffmpeg...`);
      const screenshotTime = duration > 0 ? duration * 0.1 : 0.5;

      await new Promise<void>((resolve, reject) => {
        ffmpeg(tempInputPath)
          .screenshots({
            timestamps: [screenshotTime],
            filename: thumbnailFilename,
            folder: tempThumbnailDir,
            size: '1280x720',
          })
          .on('end', () => resolve())
          .on('error', (err) =>
            reject(err instanceof Error ? err : new Error(String(err))),
          );
      });

      // 4. Read thumbnail into buffer and upload to MinIO thumbnails bucket
      this.logger.log(`Uploading thumbnail to MinIO...`);
      const thumbnailBuffer = fs.readFileSync(tempThumbnailPath);
      const thumbnailKey = `thumbnails/${videoId}/thumbnail.jpg`;

      await this.storageService.uploadBuffer(
        this.storageCfg.bucketThumbnails,
        thumbnailKey,
        thumbnailBuffer,
        'image/jpeg',
      );

      // 5. Update Video DB record with READY status, duration, thumbnail_key, and metadata
      video.status = VideoStatus.READY;
      video.duration = duration;
      video.thumbnail_key = thumbnailKey;
      video.metadata = metadataObj;
      await this.videoRepository.save(video);

      this.logger.log(`Video ${videoId} processed successfully!`);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`Error processing video ${videoId}: ${error.message}`);

      // Update Video DB record with FAILED status
      video.status = VideoStatus.FAILED;
      video.failure_reason = error.message || 'Unknown processing error';
      await this.videoRepository.save(video);

      throw err;
    } finally {
      // Clean up temp files
      if (fs.existsSync(tempInputPath)) {
        try {
          fs.unlinkSync(tempInputPath);
        } catch {
          // ignore
        }
      }
      if (fs.existsSync(tempThumbnailPath)) {
        try {
          fs.unlinkSync(tempThumbnailPath);
        } catch {
          // ignore
        }
      }
    }
  }
}
