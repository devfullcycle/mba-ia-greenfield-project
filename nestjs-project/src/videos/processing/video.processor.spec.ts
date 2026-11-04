import * as fsPromises from 'node:fs/promises';
import { Readable } from 'node:stream';
import { Video, VideoStatus } from '../entities/video.entity';
import { PROCESS_VIDEO_JOB } from '../videos.service';
import { VideoProcessor } from './video.processor';

describe('VideoProcessor (unit)', () => {
  let videoRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let storageService: {
    getObjectStream: jest.Mock;
    putObject: jest.Mock;
  };
  let mediaProbeService: {
    extractMetadata: jest.Mock;
    generateThumbnail: jest.Mock;
  };
  let processor: VideoProcessor;

  beforeEach(() => {
    videoRepository = {
      findOne: jest.fn(),
      save: jest.fn((v: unknown) => Promise.resolve(v)),
    };
    storageService = {
      getObjectStream: jest.fn().mockResolvedValue({
        stream: Readable.from(Buffer.from('fake-mp4-bytes')),
        contentLength: 14,
      }),
      putObject: jest.fn().mockResolvedValue(undefined),
    };
    mediaProbeService = {
      extractMetadata: jest.fn().mockResolvedValue({
        durationSeconds: 45,
        width: 1280,
        height: 720,
        codec: 'h264',
      }),
      generateThumbnail: jest
        .fn()
        .mockImplementation(async (_in: string, outPath: string) => {
          await fsPromises.writeFile(
            outPath,
            Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
          );
        }),
    };

    processor = new VideoProcessor(
      videoRepository as any,
      storageService as any,
      mediaProbeService as any,
    );
  });

  it('extracts metadata, generates and uploads thumbnail, and marks video as ready', async () => {
    const video: Video = {
      id: 'vid-1',
      channel_id: 'chan-1',
      slug: 'Slug1234567',
      title: 'Test Video',
      description: null,
      status: VideoStatus.PROCESSING,
      storage_key: 'videos/vid-1/original.mp4',
      thumbnail_key: null,
      upload_id: null,
      original_filename: 'test.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1024,
      duration_seconds: null,
      width: null,
      height: null,
      codec: null,
      processing_error: null,
      created_at: new Date(),
      updated_at: new Date(),
    } as Video;

    videoRepository.findOne.mockResolvedValueOnce(video);

    await processor.process({
      id: 'job-1',
      name: PROCESS_VIDEO_JOB,
      data: { videoId: 'vid-1', storageKey: 'videos/vid-1/original.mp4' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    expect(storageService.putObject).toHaveBeenCalledWith(
      'thumbnails/vid-1/thumb.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
    expect(video.status).toBe(VideoStatus.READY);
    expect(video.duration_seconds).toBe(45);
    expect(video.width).toBe(1280);
    expect(video.height).toBe(720);
    expect(video.codec).toBe('h264');
    expect(video.thumbnail_key).toBe('thumbnails/vid-1/thumb.jpg');
    expect(videoRepository.save).toHaveBeenCalledWith(video);
  });

  it('marks video as failed and records processing_error on final retry attempt', async () => {
    const video: Video = {
      id: 'vid-corrupt',
      channel_id: 'chan-1',
      slug: 'CorruptSlug',
      title: 'Corrupt Video',
      status: VideoStatus.PROCESSING,
      storage_key: 'videos/vid-corrupt/original.mp4',
    } as Video;

    videoRepository.findOne.mockResolvedValueOnce(video);
    mediaProbeService.extractMetadata.mockRejectedValueOnce(
      new Error('Invalid data found when processing input'),
    );

    await expect(
      processor.process({
        id: 'job-2',
        name: PROCESS_VIDEO_JOB,
        data: {
          videoId: 'vid-corrupt',
          storageKey: 'videos/vid-corrupt/original.mp4',
        },
        attemptsMade: 2,
        opts: { attempts: 3 },
      } as any),
    ).rejects.toThrow('Invalid data found when processing input');

    expect(video.status).toBe(VideoStatus.FAILED);
    expect(video.processing_error).toContain(
      'Invalid data found when processing input',
    );
    expect(videoRepository.save).toHaveBeenCalledWith(video);
  });
});
