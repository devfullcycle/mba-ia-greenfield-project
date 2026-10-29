import type { FindOperator, Repository } from 'typeorm';
import type { StorageService } from '../storage/storage.service';
import type { Video } from '../videos/entities/video.entity';
import { ProcessingStatus } from '../videos/video.enums';
import { StaleUploadSweeper } from './stale-upload.sweeper';
import {
  STALE_UPLOAD_FAILURE_REASON,
  STALE_UPLOAD_MAX_AGE_MS,
} from './worker.constants';

const NOW = new Date('2026-10-28T12:00:00.000Z');

function makeStaleVideo(id: string, uploadId: string | null = 'upload'): Video {
  return {
    id,
    objectKey: `videos/${id}/original.mp4`,
    uploadId,
    processingStatus: ProcessingStatus.UPLOADING,
    failureReason: null,
  } as Video;
}

describe('StaleUploadSweeper', () => {
  let videoRepository: { find: jest.Mock; save: jest.Mock };
  let storageService: { abortMultipartUpload: jest.Mock };
  let sweeper: StaleUploadSweeper;

  beforeEach(() => {
    videoRepository = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((video: Video) => Promise.resolve(video)),
    };
    storageService = {
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
    };
    sweeper = new StaleUploadSweeper(
      videoRepository as unknown as Repository<Video>,
      storageService as unknown as StorageService,
    );
  });

  it('should look for UPLOADING videos last updated more than 24 hours ago', async () => {
    await sweeper.sweep(NOW);

    const options = (videoRepository.find.mock.calls as unknown[][])[0][0] as {
      where: {
        processingStatus: ProcessingStatus;
        updatedAt: FindOperator<Date>;
      };
    };
    expect(options.where.processingStatus).toBe(ProcessingStatus.UPLOADING);
    expect(options.where.updatedAt.type).toBe('lessThan');
    expect(options.where.updatedAt.value.getTime()).toBe(
      NOW.getTime() - STALE_UPLOAD_MAX_AGE_MS,
    );
  });

  it('should abort the multipart upload and mark each stale video FAILED', async () => {
    const stale = makeStaleVideo('video-1');
    videoRepository.find.mockResolvedValue([stale]);

    const result = await sweeper.sweep(NOW);

    expect(storageService.abortMultipartUpload).toHaveBeenCalledWith(
      'videos/video-1/original.mp4',
      'upload',
    );
    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'video-1',
        processingStatus: ProcessingStatus.FAILED,
        failureReason: STALE_UPLOAD_FAILURE_REASON,
        uploadId: null,
      }),
    );
    expect(result).toEqual({ swept: 1, skipped: 0 });
  });

  it('should still fail a stale video that has no multipart uploadId, without calling storage', async () => {
    videoRepository.find.mockResolvedValue([makeStaleVideo('video-1', null)]);

    const result = await sweeper.sweep(NOW);

    expect(storageService.abortMultipartUpload).not.toHaveBeenCalled();
    expect(result.swept).toBe(1);
  });

  it('should leave a video UPLOADING for the next run when the abort fails, and keep sweeping the others', async () => {
    const broken = makeStaleVideo('video-broken');
    const healthy = makeStaleVideo('video-ok');
    videoRepository.find.mockResolvedValue([broken, healthy]);
    storageService.abortMultipartUpload.mockImplementation((key: string) =>
      key.includes('video-broken')
        ? Promise.reject(new Error('storage down'))
        : Promise.resolve(),
    );

    const result = await sweeper.sweep(NOW);

    expect(broken.processingStatus).toBe(ProcessingStatus.UPLOADING);
    expect(broken.uploadId).toBe('upload');
    expect(healthy.processingStatus).toBe(ProcessingStatus.FAILED);
    expect(videoRepository.save).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ swept: 1, skipped: 1 });
  });

  it('should do nothing when there are no stale uploads', async () => {
    const result = await sweeper.sweep(NOW);

    expect(storageService.abortMultipartUpload).not.toHaveBeenCalled();
    expect(videoRepository.save).not.toHaveBeenCalled();
    expect(result).toEqual({ swept: 0, skipped: 0 });
  });
});
