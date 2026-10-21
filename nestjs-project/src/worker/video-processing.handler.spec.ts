import { Repository } from 'typeorm';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/videos.constants';
import { FfmpegService } from './ffmpeg.service';
import { VideoProcessingHandler } from './video-processing.handler';

const job = (overrides = {}) => ({
  id: 'job-1',
  data: { videoId: 'vid-1' },
  retryCount: 0,
  retryLimit: 3,
  ...overrides,
});

describe('VideoProcessingHandler', () => {
  let videos: { findOne: jest.Mock; update: jest.Mock };
  let storage: { presignInternalGetUrl: jest.Mock; putObject: jest.Mock };
  let ffmpeg: { probe: jest.Mock; extractThumbnail: jest.Mock };
  let queue: { work: jest.Mock };
  let handler: VideoProcessingHandler;

  const processing = () =>
    ({
      id: 'vid-1',
      public_id: 'abc',
      status: VideoStatus.PROCESSING,
      storage_key: 'videos/abc/original',
    }) as Video;

  beforeEach(() => {
    videos = {
      findOne: jest.fn().mockResolvedValue(processing()),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    storage = {
      presignInternalGetUrl: jest.fn().mockResolvedValue('http://storage/get'),
      putObject: jest.fn().mockResolvedValue(undefined),
    };
    ffmpeg = {
      probe: jest.fn().mockResolvedValue({
        durationSeconds: 20,
        metadata: { format: { duration: '20' } },
      }),
      extractThumbnail: jest.fn().mockResolvedValue(Buffer.from('jpeg')),
    };
    queue = { work: jest.fn().mockResolvedValue(undefined) };
    handler = new VideoProcessingHandler(
      videos as unknown as Repository<Video>,
      storage as unknown as StorageService,
      ffmpeg as unknown as FfmpegService,
      queue as unknown as QueueService,
    );
  });

  it('should register itself as the video.process worker on bootstrap', async () => {
    await handler.onApplicationBootstrap();

    expect(queue.work).toHaveBeenCalledWith(
      'video.process',
      expect.any(Function),
    );
  });

  it('should probe, store the thumbnail and mark the video ready', async () => {
    await handler.handle(job());

    expect(ffmpeg.probe).toHaveBeenCalledWith('http://storage/get');
    expect(ffmpeg.extractThumbnail).toHaveBeenCalledWith(
      'http://storage/get',
      2,
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      'videos/abc/thumbnail.jpg',
      Buffer.from('jpeg'),
      'image/jpeg',
    );
    expect(videos.update).toHaveBeenCalledWith(
      { id: 'vid-1', status: VideoStatus.PROCESSING },
      expect.objectContaining({
        status: VideoStatus.READY,
        duration_seconds: 20,
        thumbnail_key: 'videos/abc/thumbnail.jpg',
      }),
    );
  });

  it.each([VideoStatus.READY, VideoStatus.FAILED, VideoStatus.UPLOADING])(
    'should do nothing for a video already %s',
    async (status) => {
      videos.findOne.mockResolvedValue({ ...processing(), status });

      await handler.handle(job());

      expect(ffmpeg.probe).not.toHaveBeenCalled();
      expect(storage.putObject).not.toHaveBeenCalled();
      expect(videos.update).not.toHaveBeenCalled();
    },
  );

  it('should drop the job when the video no longer exists', async () => {
    videos.findOne.mockResolvedValue(null);

    await expect(handler.handle(job())).resolves.toBeUndefined();

    expect(ffmpeg.probe).not.toHaveBeenCalled();
  });

  it('should rethrow without marking failed while retries remain', async () => {
    ffmpeg.probe.mockRejectedValue(new Error('not a video'));

    await expect(handler.handle(job({ retryCount: 1 }))).rejects.toThrow(
      'not a video',
    );

    expect(videos.update).not.toHaveBeenCalled();
  });

  it('should mark the video failed on the last attempt and still rethrow', async () => {
    ffmpeg.probe.mockRejectedValue(new Error('not a video'));

    await expect(handler.handle(job({ retryCount: 3 }))).rejects.toThrow(
      'not a video',
    );

    expect(videos.update).toHaveBeenCalledWith(
      { id: 'vid-1', status: VideoStatus.PROCESSING },
      { status: VideoStatus.FAILED },
    );
  });
});
