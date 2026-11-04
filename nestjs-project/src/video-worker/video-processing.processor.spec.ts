import type { ConfigType } from '@nestjs/config';
import type { Job } from 'bullmq';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { Repository } from 'typeorm';
import storageConfig from '../config/storage.config';
import { PROCESS_VIDEO_JOB } from '../queue/queue.constants';
import type { VideoProcessingJob } from '../queue/jobs/video-processing.job';
import type { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import type { FfmpegService } from './services/ffmpeg.service';
import { VideoProcessingProcessor } from './video-processing.processor';

const CONFIG = {
  endpoint: 'minio',
  port: 9000,
  accessKey: 'minioadmin',
  secretKey: 'minioadmin',
  bucketVideos: 'videos',
  bucketThumbnails: 'thumbnails',
  useSsl: false,
} as ConfigType<typeof storageConfig>;

function buildJob(): Job<VideoProcessingJob> {
  return {
    name: PROCESS_VIDEO_JOB,
    data: {
      videoId: '11111111-1111-4111-8111-111111111111',
      storageKey: 'videos/1/clip.mp4',
      bucket: 'videos',
    },
  } as Job<VideoProcessingJob>;
}

describe('VideoProcessingProcessor', () => {
  let repository: { update: jest.Mock };
  let storageService: {
    getObjectStream: jest.Mock;
    uploadStream: jest.Mock;
  };
  let ffmpegService: {
    extractMetadata: jest.Mock;
    generateThumbnail: jest.Mock;
  };
  let processor: VideoProcessingProcessor;

  beforeEach(() => {
    repository = { update: jest.fn().mockResolvedValue({}) };
    storageService = {
      getObjectStream: jest.fn().mockResolvedValue({
        stream: Readable.from('video-content'),
        contentLength: 13,
      }),
      uploadStream: jest
        .fn()
        .mockImplementation(async (_key: string, stream: Readable) => {
          for await (const _chunk of stream) {
            void _chunk;
            // Drain the stream so the underlying file handle is released.
          }
        }),
    };
    ffmpegService = {
      extractMetadata: jest.fn().mockResolvedValue({
        duration: 12,
        width: 1920,
        height: 1080,
      }),
      generateThumbnail: jest
        .fn()
        .mockImplementation((_input: string, output: string) =>
          writeFile(output, Buffer.from('thumbnail')),
        ),
    };

    processor = new VideoProcessingProcessor(
      repository as unknown as Repository<Video>,
      storageService as unknown as StorageService,
      ffmpegService as unknown as FfmpegService,
      CONFIG,
    );
  });

  it('marks the video ready and stores the thumbnail on success', async () => {
    await processor.process(buildJob());

    expect(storageService.getObjectStream).toHaveBeenCalledWith(
      'videos/1/clip.mp4',
      'videos',
    );
    expect(storageService.uploadStream).toHaveBeenCalledWith(
      'thumbnails/11111111-1111-4111-8111-111111111111/thumbnail.jpg',
      expect.anything(),
      'image/jpeg',
      'thumbnails',
    );
    expect(repository.update).toHaveBeenCalledWith(
      { id: '11111111-1111-4111-8111-111111111111' },
      expect.objectContaining({
        status: VideoStatus.READY,
        duration_seconds: 12,
        thumbnail_key:
          'thumbnails/11111111-1111-4111-8111-111111111111/thumbnail.jpg',
        error_message: null,
      }),
    );
  });

  it('marks the video as error and rethrows when processing fails', async () => {
    ffmpegService.extractMetadata.mockRejectedValueOnce(
      new Error('ffmpeg failed'),
    );

    await expect(processor.process(buildJob())).rejects.toThrow(
      'ffmpeg failed',
    );

    expect(repository.update).toHaveBeenCalledWith(
      { id: '11111111-1111-4111-8111-111111111111' },
      {
        status: VideoStatus.ERROR,
        error_message: 'ffmpeg failed',
      },
    );
    expect(storageService.uploadStream).not.toHaveBeenCalled();
  });

  it('ignores jobs with a different name', async () => {
    const job = buildJob();
    job.name = 'other-job';

    await processor.process(job);

    expect(storageService.getObjectStream).not.toHaveBeenCalled();
  });
});
