import { EventEmitter } from 'events';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Job } from 'bullmq';

import mockedFfmpeg from 'fluent-ffmpeg';
import { pipeline as mockedPipeline } from 'stream/promises';
import { Video } from '../../../nestjs-project/src/videos/entities/video.entity';
import { StorageService } from '../../../nestjs-project/src/storage/storage.service';
import { ProcessVideoJobData } from '../../../nestjs-project/src/videos/interfaces/process-video-job.interface';
import { VideoProcessorService } from './video-processor.service';

// Shared mutable toggle so individual tests can force the mocked
// `.screenshots()` chain to emit 'error' instead of 'end'.
let screenshotShouldFail = false;

// fluent-ffmpeg's chainable API has no practical way to be mocked without
// `any` at the module-factory boundary — jest.mock factories construct a
// fresh module shape at runtime, not a typed instance.
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
jest.mock('fluent-ffmpeg', () => {
  const mockFfmpeg: any = jest.fn(() => {
    const emitter = new EventEmitter();
    const chain: any = emitter;
    chain.screenshots = jest.fn(() => {
      process.nextTick(() => {
        if (screenshotShouldFail) {
          emitter.emit('error', new Error('screenshot codec error'));
        } else {
          emitter.emit('end');
        }
      });
      return chain;
    });
    return chain;
  });
  mockFfmpeg.setFfmpegPath = jest.fn();
  mockFfmpeg.setFfprobePath = jest.fn();
  mockFfmpeg.ffprobe = jest.fn(
    (
      _path: string,
      cb: (err: Error | null, data: { format: { duration: number } }) => void,
    ) => cb(null, { format: { duration: 3.2 } }),
  );
  return mockFfmpeg;
});
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    createWriteStream: jest.fn(() => {
      const { Writable } = jest.requireActual('stream');
      const w = new Writable({
        write(_chunk: unknown, _enc: unknown, cb: () => void) {
          cb();
        },
      });
      return w;
    }),
    promises: {
      ...actual.promises,
      readFile: jest.fn().mockResolvedValue(Buffer.from('fake-thumbnail')),
      rm: jest.fn().mockResolvedValue(undefined),
    },
  };
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */

jest.mock('stream/promises', () => ({
  pipeline: jest.fn().mockResolvedValue(undefined),
}));

const mockedFfprobe = mockedFfmpeg.ffprobe as jest.Mock;
const mockedPipelineFn = mockedPipeline as unknown as jest.Mock;

describe('VideoProcessorService', () => {
  let service: VideoProcessorService;

  const videoRepository = {
    findOneBy: jest.fn(),
    save: jest.fn((v: Partial<Video>) => Promise.resolve(v as Video)),
  };
  const storageService = {
    getObjectStream: jest.fn(),
    putObject: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    screenshotShouldFail = false;
    mockedPipelineFn.mockResolvedValue(undefined);
    mockedFfprobe.mockImplementation(
      (
        _path: string,
        cb: (err: Error | null, data: { format: { duration: number } }) => void,
      ) => cb(null, { format: { duration: 3.2 } }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoProcessorService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    service = module.get(VideoProcessorService);
  });

  function buildJob(videoId: string): Job<ProcessVideoJobData> {
    return { data: { videoId } } as Job<ProcessVideoJobData>;
  }

  function buildVideo(overrides: Partial<Video> = {}): Video {
    return {
      id: 'video-1',
      storage_key: 'videos/video-1/original',
      status: 'processing',
      duration_seconds: null,
      thumbnail_key: null,
      failure_reason: null,
      ...overrides,
    } as Video;
  }

  it('should orchestrate download, ffprobe, screenshot, upload, and status update in order', async () => {
    videoRepository.findOneBy.mockResolvedValue(buildVideo());
    storageService.getObjectStream.mockResolvedValue(new EventEmitter() as any);
    storageService.putObject.mockResolvedValue(undefined);

    await service.process(buildJob('video-1'));

    expect(storageService.getObjectStream).toHaveBeenCalledWith(
      'videos/video-1/original',
    );
    expect(storageService.putObject).toHaveBeenCalledWith(
      'videos/video-1/thumbnail.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        duration_seconds: 3.2,
        thumbnail_key: 'videos/video-1/thumbnail.jpg',
      }),
    );
  });

  it('should not throw when the video no longer exists', async () => {
    videoRepository.findOneBy.mockResolvedValue(null);

    await expect(service.process(buildJob('missing'))).resolves.not.toThrow();
    expect(storageService.getObjectStream).not.toHaveBeenCalled();
  });

  describe('failure handling', () => {
    it('should mark the video failed when the download fails', async () => {
      videoRepository.findOneBy.mockResolvedValue(buildVideo());
      storageService.getObjectStream.mockRejectedValue(new Error('S3 timeout'));

      await expect(service.process(buildJob('video-1'))).resolves.not.toThrow();

      expect(videoRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          failure_reason: 'S3 timeout',
        }),
      );
    });

    it('should mark the video failed when ffprobe fails', async () => {
      videoRepository.findOneBy.mockResolvedValue(buildVideo());
      storageService.getObjectStream.mockResolvedValue(
        new EventEmitter() as any,
      );
      mockedFfprobe.mockImplementation(
        (_path: string, cb: (err: Error) => void) =>
          cb(new Error('unrecognized format')),
      );

      await expect(service.process(buildJob('video-1'))).resolves.not.toThrow();

      expect(videoRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          failure_reason: 'unrecognized format',
        }),
      );
    });

    it('should mark the video failed when the screenshot generation fails', async () => {
      videoRepository.findOneBy.mockResolvedValue(buildVideo());
      storageService.getObjectStream.mockResolvedValue(
        new EventEmitter() as any,
      );
      screenshotShouldFail = true;

      await expect(service.process(buildJob('video-1'))).resolves.not.toThrow();

      expect(videoRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          failure_reason: 'screenshot codec error',
        }),
      );
    });

    it('should mark the video failed when the thumbnail upload fails', async () => {
      videoRepository.findOneBy.mockResolvedValue(buildVideo());
      storageService.getObjectStream.mockResolvedValue(
        new EventEmitter() as any,
      );
      storageService.putObject.mockRejectedValue(new Error('bucket full'));

      await expect(service.process(buildJob('video-1'))).resolves.not.toThrow();

      expect(videoRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          failure_reason: 'bucket full',
        }),
      );
    });

    it('should not throw out of process() when a failure occurs', async () => {
      videoRepository.findOneBy.mockResolvedValue(buildVideo());
      storageService.getObjectStream.mockRejectedValue(new Error('boom'));

      await expect(
        service.process(buildJob('video-1')),
      ).resolves.toBeUndefined();
    });
  });
});
