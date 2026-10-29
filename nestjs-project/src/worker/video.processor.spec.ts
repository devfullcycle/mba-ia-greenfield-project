import * as fsPromises from 'fs/promises';
import type { Job } from 'bullmq';
import type { Repository } from 'typeorm';
import {
  PROCESS_VIDEO_JOB,
  SWEEP_STALE_UPLOADS_JOB,
} from '../queue/queue.constants';
import type { ProcessVideoJobData } from '../queue/video-processing.producer';
import type { StorageService } from '../storage/storage.service';
import type { Video } from '../videos/entities/video.entity';
import { ProcessingStatus } from '../videos/video.enums';
import {
  InvalidMediaError,
  MediaToolError,
  type MediaProbeService,
} from './media-probe.service';
import type { StaleUploadSweeper } from './stale-upload.sweeper';
import { VideoProcessor } from './video.processor';

jest.mock('fs/promises', () => ({
  ...jest.requireActual<typeof fsPromises>('fs/promises'),
  readFile: jest.fn(),
}));

function callArg<T>(mock: jest.Mock, call: number, arg: number): T {
  return (mock.mock.calls as unknown[][])[call][arg] as T;
}

const PROBE = {
  durationSeconds: 100,
  metadata: {
    container: 'mov,mp4',
    bitRate: 1,
    video: { codec: 'h264', width: 10, height: 10, frameRate: '30/1' },
    audio: null,
  },
};

function makeJob(
  overrides: { attemptsMade?: number; attempts?: number; name?: string } = {},
): Job<ProcessVideoJobData> {
  return {
    name: overrides.name ?? PROCESS_VIDEO_JOB,
    data: { videoId: 'video-1' },
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: { attempts: overrides.attempts ?? 3 },
  } as unknown as Job<ProcessVideoJobData>;
}

describe('VideoProcessor', () => {
  let videoRepository: {
    findOneBy: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let storageService: {
    presignGetInternal: jest.Mock;
    getObjectToFile: jest.Mock;
    putObject: jest.Mock;
  };
  let mediaProbeService: { probe: jest.Mock; extractThumbnail: jest.Mock };
  let staleUploadSweeper: { sweep: jest.Mock };
  let processor: VideoProcessor;

  function stubVideo(overrides: Partial<Video> = {}): Video {
    const video = {
      id: 'video-1',
      objectKey: 'videos/video-1/original.mp4',
      processingStatus: ProcessingStatus.PROCESSING,
      durationSeconds: null,
      metadata: null,
      failureReason: null,
      ...overrides,
    } as Video;
    videoRepository.findOneBy.mockResolvedValue(video);
    return video;
  }

  beforeEach(() => {
    jest.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('jpg'));
    videoRepository = {
      findOneBy: jest.fn(),
      save: jest.fn((video: Video) => Promise.resolve(video)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    storageService = {
      presignGetInternal: jest.fn().mockResolvedValue('http://storage/signed'),
      getObjectToFile: jest.fn().mockResolvedValue(undefined),
      putObject: jest.fn().mockResolvedValue(undefined),
    };
    mediaProbeService = {
      probe: jest.fn().mockResolvedValue(PROBE),
      extractThumbnail: jest.fn().mockResolvedValue(undefined),
    };
    staleUploadSweeper = {
      sweep: jest.fn().mockResolvedValue({ swept: 0, skipped: 0 }),
    };
    processor = new VideoProcessor(
      videoRepository as unknown as Repository<Video>,
      storageService as unknown as StorageService,
      mediaProbeService as unknown as MediaProbeService,
      staleUploadSweeper as unknown as StaleUploadSweeper,
    );
  });

  describe('process', () => {
    it('should probe through the presigned URL, upload the thumbnail and mark the video READY', async () => {
      const video = stubVideo();

      await processor.process(makeJob());

      expect(storageService.presignGetInternal).toHaveBeenCalledWith(
        'videos/video-1/original.mp4',
      );
      expect(mediaProbeService.probe).toHaveBeenCalledWith(
        'http://storage/signed',
      );
      expect(mediaProbeService.extractThumbnail).toHaveBeenCalledWith(
        'http://storage/signed',
        10,
        expect.stringContaining('thumbnail.jpg') as string,
      );
      expect(storageService.putObject).toHaveBeenCalledWith(
        'videos/video-1/thumbnail.jpg',
        Buffer.from('jpg'),
        'image/jpeg',
      );
      expect(storageService.getObjectToFile).not.toHaveBeenCalled();
      expect(videoRepository.save).toHaveBeenCalledWith(video);
      expect(video.processingStatus).toBe(ProcessingStatus.READY);
      expect(video.durationSeconds).toBe('100');
      expect(video.metadata).toEqual(PROBE.metadata);
    });

    it('should fall back to a local copy when reading the presigned URL fails', async () => {
      stubVideo();
      mediaProbeService.probe
        .mockRejectedValueOnce(new MediaToolError('ffprobe failed: <url>'))
        .mockResolvedValueOnce(PROBE);

      await processor.process(makeJob());

      expect(storageService.getObjectToFile).toHaveBeenCalledWith(
        'videos/video-1/original.mp4',
        expect.stringContaining('original') as string,
      );
      const localInput = callArg<string>(mediaProbeService.probe, 1, 0);
      expect(localInput).toContain('original');
      expect(videoRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ processingStatus: ProcessingStatus.READY }),
      );
    });

    it('should reject, without changing the video, when the local copy is not a video either', async () => {
      const video = stubVideo();
      mediaProbeService.probe
        .mockRejectedValueOnce(new MediaToolError('ffprobe failed: <url>'))
        .mockRejectedValueOnce(
          new InvalidMediaError('The file has no video stream'),
        );

      await expect(processor.process(makeJob())).rejects.toThrow(
        InvalidMediaError,
      );

      expect(videoRepository.save).not.toHaveBeenCalled();
      expect(storageService.putObject).not.toHaveBeenCalled();
      expect(video.processingStatus).toBe(ProcessingStatus.PROCESSING);
    });

    it('should leave a video that is already READY untouched', async () => {
      stubVideo({ processingStatus: ProcessingStatus.READY });

      await processor.process(makeJob());

      expect(mediaProbeService.probe).not.toHaveBeenCalled();
      expect(storageService.putObject).not.toHaveBeenCalled();
      expect(videoRepository.save).not.toHaveBeenCalled();
    });

    it.each([ProcessingStatus.UPLOADING, ProcessingStatus.FAILED])(
      'should skip a video that is %s',
      async (status) => {
        stubVideo({ processingStatus: status });

        await processor.process(makeJob());

        expect(mediaProbeService.probe).not.toHaveBeenCalled();
        expect(videoRepository.save).not.toHaveBeenCalled();
      },
    );

    it('should ignore a job whose video no longer exists', async () => {
      videoRepository.findOneBy.mockResolvedValue(null);

      await expect(processor.process(makeJob())).resolves.toBeUndefined();

      expect(mediaProbeService.probe).not.toHaveBeenCalled();
    });

    it('should run the stale upload sweeper for a sweep-stale-uploads job', async () => {
      await processor.process(makeJob({ name: SWEEP_STALE_UPLOADS_JOB }));

      expect(staleUploadSweeper.sweep).toHaveBeenCalledTimes(1);
      expect(videoRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('should not run the sweeper for a process-video job', async () => {
      stubVideo({ processingStatus: ProcessingStatus.READY });

      await processor.process(makeJob());

      expect(staleUploadSweeper.sweep).not.toHaveBeenCalled();
    });

    it('should reject jobs it does not know how to handle', async () => {
      await expect(
        processor.process(makeJob({ name: 'something-else' })),
      ).rejects.toThrow('Unsupported job');
    });
  });

  describe('onFailed', () => {
    it('should keep the video PROCESSING while retries remain', async () => {
      await processor.onFailed(
        makeJob({ attemptsMade: 1 }),
        new Error('transient'),
      );

      expect(videoRepository.update).not.toHaveBeenCalled();
    });

    it('should mark the video FAILED with a failureReason once the attempts are exhausted', async () => {
      await processor.onFailed(
        makeJob({ attemptsMade: 3 }),
        new Error('The file has no video stream'),
      );

      expect(videoRepository.update).toHaveBeenCalledWith(
        { id: 'video-1', processingStatus: ProcessingStatus.PROCESSING },
        {
          processingStatus: ProcessingStatus.FAILED,
          failureReason: 'The file has no video stream',
        },
      );
    });

    it('should truncate a long failureReason to the column size', async () => {
      await processor.onFailed(
        makeJob({ attemptsMade: 3 }),
        new Error('x'.repeat(500)),
      );

      const changes = callArg<{ failureReason: string }>(
        videoRepository.update,
        0,
        1,
      );
      expect(changes.failureReason).toHaveLength(255);
    });

    it('should ignore failures of other job types and jobs without a handle', async () => {
      await processor.onFailed(
        makeJob({ attemptsMade: 3, name: 'sweep-stale-uploads' }),
        new Error('boom'),
      );
      await processor.onFailed(undefined, new Error('boom'));

      expect(videoRepository.update).not.toHaveBeenCalled();
    });
  });
});
