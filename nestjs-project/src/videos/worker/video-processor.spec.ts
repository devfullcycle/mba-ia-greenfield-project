import { Readable } from 'stream';
import * as fs from 'fs';
import { VideoProcessor } from './video-processor';
import { Video, VideoStatus } from '../entities/video.entity';

jest.mock('fluent-ffmpeg', () => {
  const ffprobe = jest.fn();
  const mockFn: any = jest.fn(() => mockFn);
  mockFn.on = jest.fn(() => mockFn);
  mockFn.screenshots = jest.fn();
  mockFn.ffprobe = ffprobe;
  return mockFn;
});

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  createWriteStream: jest.fn(),
  existsSync: jest.fn(),
  promises: {
    ...jest.requireActual('fs').promises,
    readFile: jest.fn(),
    unlink: jest.fn(),
  },
}));

jest.mock('stream/promises', () => ({
  pipeline: jest.fn(),
}));

import ffmpeg from 'fluent-ffmpeg';
import { pipeline } from 'stream/promises';

function makeVideo(overrides: Partial<Video> = {}): Video {
  const video = new Video();
  video.id = 'video-id';
  video.url_code = 'abc123456789';
  video.title = 'Title';
  video.description = null;
  video.status = VideoStatus.PROCESSING;
  video.status_details = null;
  video.channel_id = 'channel-id';
  video.original_filename = 'movie.mp4';
  video.storage_key = 'videos/abc123456789.mp4';
  video.thumbnail_key = null;
  video.duration_seconds = null;
  video.size_bytes = null;
  video.resolution_width = null;
  video.resolution_height = null;
  video.codec = null;
  Object.assign(video, overrides);
  return video;
}

function makeJob(videoId: string) {
  return {
    id: 'job-1',
    data: {
      videoId,
      urlCode: 'abc123456789',
      storageKey: 'videos/abc123456789.mp4',
    },
  } as any;
}

describe('VideoProcessor', () => {
  let videoRepository: any;
  let storageService: any;
  let processor: VideoProcessor;

  beforeEach(() => {
    jest.clearAllMocks();

    videoRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    storageService = {
      getObjectStream: jest.fn(),
      uploadBuffer: jest.fn(),
    };

    (fs.createWriteStream as jest.Mock).mockReturnValue({});
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.promises.unlink as jest.Mock).mockResolvedValue(undefined);
    (pipeline as jest.Mock).mockResolvedValue(undefined);

    processor = new VideoProcessor(videoRepository, storageService, {
      bucketVideos: 'videos',
      bucketThumbnails: 'thumbnails',
    } as any);
  });

  it('does nothing when the video is not found', async () => {
    videoRepository.findOne.mockResolvedValue(null);

    await processor.process(makeJob('missing-id'));

    expect(storageService.getObjectStream).not.toHaveBeenCalled();
    expect(videoRepository.save).not.toHaveBeenCalled();
  });

  it('aborts when the video is not in processing status', async () => {
    const video = makeVideo({ status: VideoStatus.DRAFT });
    videoRepository.findOne.mockResolvedValue(video);

    await processor.process(makeJob(video.id));

    expect(storageService.getObjectStream).not.toHaveBeenCalled();
    expect(videoRepository.save).not.toHaveBeenCalled();
  });

  it('processes a video successfully and marks it ready', async () => {
    const video = makeVideo();
    videoRepository.findOne.mockResolvedValue(video);
    storageService.getObjectStream.mockResolvedValue({
      stream: Readable.from(['data']),
      contentLength: 1024,
    });
    (ffmpeg.ffprobe as jest.Mock).mockImplementation((_path, cb) =>
      cb(null, {
        streams: [
          {
            codec_type: 'video',
            width: 1920,
            height: 1080,
            codec_name: 'h264',
          },
        ],
        format: { duration: 12.5, size: 2048 },
      }),
    );
    (ffmpeg as any).mockImplementation(() => {
      const chain: any = {};
      chain.on = jest.fn((event: string, cb: () => void) => {
        if (event === 'end') {
          cb();
        }
        return chain;
      });
      chain.screenshots = jest.fn(() => chain);
      return chain;
    });
    (fs.promises.readFile as jest.Mock).mockResolvedValue(Buffer.from('thumb'));
    videoRepository.save.mockResolvedValue(video);

    await processor.process(makeJob(video.id));

    expect(storageService.uploadBuffer).toHaveBeenCalledWith(
      'thumbnails',
      'thumbnails/thumb-abc123456789.jpg',
      Buffer.from('thumb'),
      'image/jpeg',
    );
    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VideoStatus.READY,
        duration_seconds: 12.5,
        resolution_width: 1920,
        resolution_height: 1080,
        codec: 'h264',
        thumbnail_key: 'thumbnails/thumb-abc123456789.jpg',
      }),
    );
  });

  it('marks the video as error and rethrows when processing fails', async () => {
    const video = makeVideo();
    videoRepository.findOne.mockResolvedValue(video);
    storageService.getObjectStream.mockResolvedValue({
      stream: Readable.from(['data']),
      contentLength: 1024,
    });
    const ffprobeError = new Error('ffprobe failed');
    (ffmpeg.ffprobe as jest.Mock).mockImplementation((_path, cb) =>
      cb(ffprobeError, null),
    );
    videoRepository.save.mockResolvedValue(video);

    await expect(processor.process(makeJob(video.id))).rejects.toThrow(
      'ffprobe failed',
    );

    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VideoStatus.ERROR,
        status_details: 'ffprobe failed',
      }),
    );
  });
});
