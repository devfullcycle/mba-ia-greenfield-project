import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ffmpeg from 'fluent-ffmpeg';
import type { Job, JobWithMetadata, PgBoss } from 'pg-boss';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { PG_BOSS, QUEUE_NAMES } from '../queue/queue.constants';
import type { VideoProcessingPayload } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { Video } from '../videos/entities/video.entity';

function extractFailureReason(output: object): string {
  const message = (output as { message?: unknown }).message;
  return typeof message === 'string' ? message : JSON.stringify(output);
}

@Injectable()
export class VideoProcessingConsumer {
  private readonly logger = new Logger(VideoProcessingConsumer.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    @Inject(PG_BOSS) private readonly boss: PgBoss,
  ) {}

  async register(): Promise<void> {
    await this.boss.work<VideoProcessingPayload>(
      QUEUE_NAMES.VIDEO_PROCESSING,
      async (jobs: Job<VideoProcessingPayload>[]) => {
        for (const job of jobs) {
          await this.handle(job.data);
        }
      },
    );

    await this.boss.work<VideoProcessingPayload>(
      QUEUE_NAMES.VIDEO_PROCESSING_DLQ,
      { includeMetadata: true },
      async (jobs: JobWithMetadata<VideoProcessingPayload>[]) => {
        for (const job of jobs) {
          await this.handleFailure(
            job.data.videoId,
            extractFailureReason(job.output),
          );
        }
      },
    );
  }

  async handle(payload: VideoProcessingPayload): Promise<void> {
    const video = await this.videoRepository.findOneByOrFail({
      id: payload.videoId,
    });
    const url = await this.storageService.presignGetObject(
      payload.key,
      'inline',
    );

    const { durationSeconds, metadata } = await this.probeMetadata(url);
    const thumbnailKey = await this.captureThumbnail(
      video.channel_id,
      payload.videoId,
      url,
    );

    // Cast the whole literal: TypeORM's QueryDeepPartialEntity recurses into
    // the jsonb column's index signature and rejects a plain object literal
    // for `metadata` otherwise, even though the runtime behavior is correct.
    await this.videoRepository.update(payload.videoId, {
      status: 'ready',
      duration_seconds: durationSeconds,
      metadata,
      thumbnail_key: thumbnailKey,
    } as QueryDeepPartialEntity<Video>);
  }

  async handleFailure(videoId: string, failureReason: string): Promise<void> {
    this.logger.error(
      `Video processing failed for ${videoId}: ${failureReason}`,
    );
    await this.videoRepository.update(videoId, {
      status: 'failed',
      failure_reason: failureReason,
    });
  }

  private probeMetadata(url: string): Promise<{
    durationSeconds: number;
    metadata: Record<string, unknown>;
  }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(url, (err, data) => {
        if (err) {
          reject(err as Error);
          return;
        }

        const videoStream = data.streams.find(
          (stream) => stream.codec_type === 'video',
        );
        const audioStream = data.streams.find(
          (stream) => stream.codec_type === 'audio',
        );

        resolve({
          durationSeconds: Math.round(data.format.duration ?? 0),
          metadata: {
            formatName: data.format.format_name ?? null,
            bitRate: data.format.bit_rate ? Number(data.format.bit_rate) : null,
            video: videoStream
              ? {
                  codec: videoStream.codec_name ?? null,
                  width: videoStream.width ?? null,
                  height: videoStream.height ?? null,
                }
              : null,
            audio: audioStream
              ? { codec: audioStream.codec_name ?? null }
              : null,
          },
        });
      });
    });
  }

  private async captureThumbnail(
    channelId: string,
    videoId: string,
    url: string,
  ): Promise<string> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'streamtube-thumbnail-'));
    const filename = 'thumbnail.jpg';

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(url)
          .screenshots({ timestamps: ['10%'], filename, folder: tmpDir })
          .on('end', () => resolve())
          .on('error', (error: Error) => reject(error));
      });

      const buffer = await readFile(join(tmpDir, filename));
      const thumbnailKey = this.storageService.buildThumbnailKey(
        channelId,
        videoId,
      );
      await this.storageService.putObject(thumbnailKey, buffer, 'image/jpeg');
      return thumbnailKey;
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}
