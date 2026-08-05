import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Video, VideoStatus } from '../entities/video.entity';
import { StorageService } from '../../storage/storage.service';
import storageConfig from '../../config/storage.config';
import { VIDEO_PROCESSING_QUEUE, VideoJobData } from '../video-job.types';

@Processor(VIDEO_PROCESSING_QUEUE)
@Injectable()
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    super();
  }

  async process(job: Job<VideoJobData>): Promise<void> {
    const { videoId, urlCode, storageKey } = job.data;
    this.logger.log(`Processing video job ${job.id} for videoId: ${videoId}`);

    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });

    if (!video) {
      this.logger.warn(`Video ${videoId} not found in database.`);
      return;
    }

    if (video.status !== VideoStatus.PROCESSING) {
      this.logger.warn(
        `Video ${videoId} is not in 'processing' status (current: ${video.status}). Aborting.`,
      );
      return;
    }

    const tempVideoPath = path.join('/tmp', `video-${videoId}.mp4`);
    const tempThumbPath = path.join('/tmp', `thumb-${videoId}.jpg`);

    try {
      const { stream, contentLength } =
        await this.storageService.getObjectStream(
          this.config.bucketVideos,
          storageKey,
        );
      const writeStream = fs.createWriteStream(tempVideoPath);
      await pipeline(stream, writeStream);

      const [metadata] = await Promise.all([
        this.extractMetadata(tempVideoPath),
        this.extractThumbnail(tempVideoPath, tempThumbPath),
      ]);

      const thumbBuffer = await fs.promises.readFile(tempThumbPath);
      const thumbnailKey = `thumbnails/thumb-${urlCode}.jpg`;
      await this.storageService.uploadBuffer(
        this.config.bucketThumbnails,
        thumbnailKey,
        thumbBuffer,
        'image/jpeg',
      );

      video.status = VideoStatus.READY;
      video.thumbnail_key = thumbnailKey;
      video.duration_seconds = metadata.duration;
      video.resolution_width = metadata.width;
      video.resolution_height = metadata.height;
      video.codec = metadata.codec;
      video.size_bytes = contentLength ?? null;
      video.status_details = null;

      await this.videoRepository.save(video);
      this.logger.log(`Video ${videoId} processed successfully.`);
    } catch (err: any) {
      this.logger.error(`Error processing video ${videoId}:`, err);
      video.status = VideoStatus.ERROR;
      video.status_details = err.message || 'Unknown processing error';
      await this.videoRepository.save(video);
      throw err;
    } finally {
      await Promise.all(
        [tempVideoPath, tempThumbPath].map((filePath) =>
          this.safeUnlink(filePath),
        ),
      );
    }
  }

  private async safeUnlink(filePath: string): Promise<void> {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath).catch(() => {});
    }
  }

  private extractMetadata(filePath: string): Promise<{
    duration: number;
    width: number;
    height: number;
    codec: string;
  }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          return reject(err instanceof Error ? err : new Error(String(err)));
        }
        const videoStream = metadata.streams?.find(
          (s) => s.codec_type === 'video',
        );
        const duration = metadata.format?.duration || 0;
        const width = videoStream?.width || 0;
        const height = videoStream?.height || 0;
        const codec = videoStream?.codec_name || 'unknown';
        resolve({ duration, width, height, codec });
      });
    });
  }

  private extractThumbnail(
    videoPath: string,
    thumbPath: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .screenshots({
          count: 1,
          timestamps: ['1'],
          filename: path.basename(thumbPath),
          folder: path.dirname(thumbPath),
        });
    });
  }
}
