import { Test } from '@nestjs/testing';
import { UnrecoverableError, type Job } from 'bullmq';
import type { ProcessVideoJobData } from '../queue/video-processing.queue';
import { StorageService } from '../storage/storage.service';
import type { Video, VideoStatus } from '../videos/entities/video.entity';
import { VideosRepository } from '../videos/videos.repository';
import { FfmpegService } from './ffmpeg.service';
import { FfmpegProcessError, NoVideoStreamError } from './processing.errors';
import { VideoProcessor } from './video.processor';

const VIDEO_ID = 'video-uuid';

describe('VideoProcessor', () => {
  const videosRepository = {
    findById: jest.fn(),
    markReady: jest.fn(),
    markError: jest.fn(),
  };
  const storage = {
    headObject: jest.fn(),
    presignInternalGet: jest.fn(),
    putObject: jest.fn(),
  };
  const ffmpeg = { probe: jest.fn(), extractFrame: jest.fn() };
  let processor: VideoProcessor;

  const job = { data: { videoId: VIDEO_ID } } as Job<ProcessVideoJobData>;
  const videoIn = (status: VideoStatus): Video =>
    ({
      id: VIDEO_ID,
      status,
      storage_key: `videos/${VIDEO_ID}/source`,
    }) as Video;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        VideoProcessor,
        { provide: VideosRepository, useValue: videosRepository },
        { provide: StorageService, useValue: storage },
        { provide: FfmpegService, useValue: ffmpeg },
      ],
    }).compile();
    processor = module.get(VideoProcessor);

    storage.headObject.mockResolvedValue({ contentLength: 1000 });
    storage.presignInternalGet.mockResolvedValue('http://minio:9000/signed');
    ffmpeg.probe.mockResolvedValue({
      duration_seconds: 10,
      width: 640,
      height: 360,
      codec: 'h264',
    });
    ffmpeg.extractFrame.mockResolvedValue(Buffer.from('jpeg'));
  });

  it.each<VideoStatus>(['DRAFT', 'READY', 'ERROR'])(
    'should acknowledge without side effects when the video is %s',
    async (status) => {
      videosRepository.findById.mockResolvedValue(videoIn(status));

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(storage.headObject).not.toHaveBeenCalled();
      expect(storage.putObject).not.toHaveBeenCalled();
      expect(videosRepository.markReady).not.toHaveBeenCalled();
    },
  );

  it('should acknowledge when the video no longer exists', async () => {
    videosRepository.findById.mockResolvedValue(null);

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(storage.headObject).not.toHaveBeenCalled();
  });

  it('should store the thumbnail and mark the video READY with its metadata', async () => {
    videosRepository.findById.mockResolvedValue(videoIn('PROCESSING'));

    await processor.process(job);

    expect(ffmpeg.extractFrame).toHaveBeenCalledWith(
      'http://minio:9000/signed',
      1,
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      `videos/${VIDEO_ID}/thumbnail.jpg`,
      Buffer.from('jpeg'),
      'image/jpeg',
    );
    expect(videosRepository.markReady).toHaveBeenCalledWith(VIDEO_ID, {
      duration_seconds: 10,
      width: 640,
      height: 360,
      codec: 'h264',
      thumbnail_key: `videos/${VIDEO_ID}/thumbnail.jpg`,
    });
  });

  it('should persist ERROR and throw UnrecoverableError on a permanent failure', async () => {
    videosRepository.findById.mockResolvedValue(videoIn('PROCESSING'));
    ffmpeg.probe.mockRejectedValue(
      new FfmpegProcessError('ffprobe', 1, 'moov atom not found'),
    );

    await expect(processor.process(job)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(videosRepository.markError).toHaveBeenCalledWith(
      VIDEO_ID,
      'INVALID_FILE',
    );
  });

  it('should rethrow a retryable error (not Unrecoverable) when persisting ERROR fails', async () => {
    videosRepository.findById.mockResolvedValue(videoIn('PROCESSING'));
    ffmpeg.probe.mockRejectedValue(new NoVideoStreamError());
    const dbDown = new Error('db down');
    videosRepository.markError.mockRejectedValue(dbDown);

    const failure = processor.process(job);

    await expect(failure).rejects.toBe(dbDown);
    await expect(failure).rejects.not.toBeInstanceOf(UnrecoverableError);
  });

  it('should rethrow infra failures without touching the status', async () => {
    videosRepository.findById.mockResolvedValue(videoIn('PROCESSING'));
    const unreachable = new Error('connect ECONNREFUSED minio:9000');
    storage.headObject.mockRejectedValue(unreachable);

    await expect(processor.process(job)).rejects.toBe(unreachable);
    expect(ffmpeg.probe).not.toHaveBeenCalled();
    expect(videosRepository.markError).not.toHaveBeenCalled();
    expect(videosRepository.markReady).not.toHaveBeenCalled();
  });
});
