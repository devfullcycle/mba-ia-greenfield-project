import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import type { FfprobeData } from 'fluent-ffmpeg';
import { StorageService } from '../../storage/storage.service';
import { VideosService } from '../../videos/videos.service';
import { generateThumbnail, parseFrameRate, probeVideo } from '../ffmpeg.util';
import { VideoProcessor } from './video.processor';

jest.mock('../ffmpeg.util');

const mockProbeVideo = probeVideo as jest.MockedFunction<typeof probeVideo>;
const mockGenerateThumbnail = generateThumbnail as jest.MockedFunction<
  typeof generateThumbnail
>;
const mockParseFrameRate = parseFrameRate as jest.MockedFunction<
  typeof parseFrameRate
>;

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    data: {
      videoId: 'video-id',
      storageKey: 'videos/abc12345def/original',
      channelId: 'channel-id',
      slug: 'abc12345def',
    },
    attemptsMade: 1,
    opts: { attempts: 3 },
    ...overrides,
  } as unknown as Job;
}

describe('VideoProcessor', () => {
  let processor: VideoProcessor;
  let storageService: jest.Mocked<StorageService>;
  let videosService: jest.Mocked<VideosService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        VideoProcessor,
        {
          provide: StorageService,
          useValue: {
            generatePresignedGetUrl: jest.fn(),
            uploadObject: jest.fn(),
          },
        },
        {
          provide: VideosService,
          useValue: {
            markProcessingReady: jest.fn(),
            markProcessingError: jest.fn(),
          },
        },
      ],
    }).compile();

    processor = module.get(VideoProcessor);
    storageService = module.get(StorageService);
    videosService = module.get(VideosService);
  });

  describe('process', () => {
    it('marks the video ready with duration, metadata and thumbnail on success', async () => {
      storageService.generatePresignedGetUrl.mockResolvedValue({
        url: 'http://minio:9000/streamtube-videos/videos/abc12345def/original?signed',
        expiresAt: new Date(),
      });
      mockProbeVideo.mockResolvedValue({
        format: { duration: 120, bit_rate: '5000000' },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            r_frame_rate: '30/1',
          },
        ],
      } as unknown as FfprobeData);
      mockGenerateThumbnail.mockResolvedValue(Buffer.from('fake-jpg-bytes'));
      mockParseFrameRate.mockReturnValue(30);

      await processor.process(makeJob());

      expect(storageService.uploadObject).toHaveBeenCalledWith(
        'videos/abc12345def/thumbnail.jpg',
        Buffer.from('fake-jpg-bytes'),
        'image/jpeg',
      );
      expect(videosService.markProcessingReady).toHaveBeenCalledWith(
        'video-id',
        {
          duration_seconds: 120,
          thumbnail_key: 'videos/abc12345def/thumbnail.jpg',
          metadata: {
            codec: 'h264',
            resolution: '1920x1080',
            bitrate: 5000000,
            fps: 30,
          },
        },
      );
      expect(videosService.markProcessingError).not.toHaveBeenCalled();
    });
  });

  describe('onFailed', () => {
    it('marks the video as error once the final attempt is exhausted', async () => {
      const job = makeJob({ attemptsMade: 3 });

      await processor.onFailed(job, new Error('ffmpeg exploded'));

      expect(videosService.markProcessingError).toHaveBeenCalledWith(
        'video-id',
        'ffmpeg exploded',
      );
    });

    it('does not mark the video as error before the final attempt', async () => {
      const job = makeJob({ attemptsMade: 1 });

      await processor.onFailed(job, new Error('transient failure'));

      expect(videosService.markProcessingError).not.toHaveBeenCalled();
    });
  });
});
