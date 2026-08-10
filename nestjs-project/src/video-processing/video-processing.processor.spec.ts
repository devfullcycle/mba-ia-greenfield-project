import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VideoProcessingProcessor } from './video-processing.processor';
import type { VideoProcessingJob } from '../videos/videos.constants';
import { Video } from '../videos/entities/video.entity';
import { StorageService } from '../storage/storage.service';
import { VideoStatus } from '../videos/videos.constants';
import { Readable, PassThrough } from 'stream';

// Prevent WorkerHost from creating a real Redis connection during test module compilation
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    off: jest.fn(),
  })),
}));

// Mock fluent-ffmpeg and ffprobe-installer
jest.mock('fluent-ffmpeg', () => {
  const mockFfprobe = jest.fn();
  const mockFfmpeg = jest.fn(() => ({
    screenshots: jest.fn().mockReturnThis(),
    on: jest.fn().mockImplementation(function (event: string, cb: () => void) {
      if (event === 'end') cb();
      return this;
    }),
  }));
  (mockFfmpeg as any).ffprobe = mockFfprobe;
  (mockFfmpeg as any).setFfprobePath = jest.fn();
  return mockFfmpeg;
});

jest.mock('@ffprobe-installer/ffprobe', () => ({ path: '/usr/bin/ffprobe' }));
jest.mock('fs');

const mockVideoRepo = {
  findOne: jest.fn(),
  update: jest.fn().mockResolvedValue({}),
};

const mockStorageService = {
  getObject: jest.fn(),
  putObject: jest.fn(),
  getBucketName: jest.fn().mockReturnValue('streamtube'),
};

function makeJob(
  overrides: Partial<VideoProcessingJob> = {},
  jobMeta: Record<string, any> = {},
): any {
  return {
    data: {
      videoId: 'v-uuid',
      storageKey: 'videos/v-uuid/original.mp4',
      bucketName: 'streamtube',
      ...overrides,
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...jobMeta,
  };
}

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'v-uuid',
    status: VideoStatus.PROCESSING,
    storage_key: 'videos/v-uuid/original.mp4',
    title: 'Test',
    channel_id: 'ch',
    thumbnail_key: null,
    duration_seconds: null,
    processing_metadata: null,
    error_cause: null,
    created_at: new Date(),
    updated_at: new Date(),
    channel: null as any,
    ...overrides,
  };
}

describe('VideoProcessingProcessor', () => {
  let processor: VideoProcessingProcessor;
  let module: TestingModule;
  let ffmpeg: any;
  let fs: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ffmpeg = require('fluent-ffmpeg');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fs = require('fs');

    fs.mkdirSync = jest.fn();
    fs.createWriteStream = jest.fn().mockReturnValue(new PassThrough());
    fs.readFileSync = jest.fn().mockReturnValue(Buffer.from('thumb'));
    fs.rmSync = jest.fn();

    const readable = new Readable({ read() {} });
    readable.push(null);
    mockStorageService.getObject.mockResolvedValue({
      stream: readable,
      contentType: 'video/mp4',
      contentLength: 1024,
    });

    ffmpeg.ffprobe.mockImplementation(
      (_path: string, cb: (err: null, data: any) => void) => {
        cb(null, {
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              width: 1280,
              height: 720,
            },
          ],
          format: { duration: 30, bit_rate: 2_000_000 },
        });
      },
    );

    module = await Test.createTestingModule({
      providers: [
        VideoProcessingProcessor,
        { provide: getRepositoryToken(Video), useValue: mockVideoRepo },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    processor = module.get(VideoProcessingProcessor);
  });

  afterEach(async () => {
    await module?.close();
  });

  it('should process video and set status to READY with metadata', async () => {
    mockVideoRepo.findOne.mockResolvedValue(makeVideo());

    await processor.process(makeJob());

    expect(mockVideoRepo.update).toHaveBeenCalledWith(
      'v-uuid',
      expect.objectContaining({
        status: VideoStatus.READY,
        duration_seconds: 30,
        processing_metadata: expect.objectContaining({
          width: 1280,
          height: 720,
          codec: 'h264',
        }),
      }),
    );
  });

  it('should discard job when video status is not PROCESSING (idempotency)', async () => {
    mockVideoRepo.findOne.mockResolvedValue(
      makeVideo({ status: VideoStatus.READY }),
    );

    await processor.process(makeJob());

    expect(mockVideoRepo.update).not.toHaveBeenCalled();
  });

  it('should discard job silently when video is not found', async () => {
    mockVideoRepo.findOne.mockResolvedValue(null);

    await processor.process(makeJob());

    expect(mockVideoRepo.update).not.toHaveBeenCalled();
  });

  it('should rethrow error so BullMQ can retry on non-final attempt', async () => {
    mockVideoRepo.findOne.mockResolvedValue(makeVideo());
    ffmpeg.ffprobe.mockImplementation((_: string, cb: (err: Error) => void) =>
      cb(new Error('ffprobe failed')),
    );

    await expect(
      processor.process(
        makeJob({}, { attemptsMade: 0, opts: { attempts: 3 } }),
      ),
    ).rejects.toThrow('ffprobe failed');
    expect(mockVideoRepo.update).not.toHaveBeenCalledWith(
      'v-uuid',
      expect.objectContaining({ status: VideoStatus.ERROR }),
    );
  });

  it('should set status to ERROR with truncated errorCause on last attempt', async () => {
    mockVideoRepo.findOne.mockResolvedValue(makeVideo());
    const longError = 'e'.repeat(3000);
    ffmpeg.ffprobe.mockImplementation((_: string, cb: (err: Error) => void) =>
      cb(new Error(longError)),
    );

    await expect(
      processor.process(
        makeJob({}, { attemptsMade: 2, opts: { attempts: 3 } }),
      ),
    ).rejects.toThrow();

    expect(mockVideoRepo.update).toHaveBeenCalledWith(
      'v-uuid',
      expect.objectContaining({
        status: VideoStatus.ERROR,
        error_cause: expect.stringMatching(/^e{2048}$/),
      }),
    );
  });
});
