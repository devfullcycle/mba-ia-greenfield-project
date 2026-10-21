import { LessThan, Repository } from 'typeorm';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/videos.constants';
import { UploadReaperHandler } from './upload-reaper.handler';
import {
  UPLOAD_INACTIVITY_LIMIT_MS,
  UPLOAD_REAP_CRON,
} from './worker.constants';

const NOW = new Date('2026-10-21T12:00:00Z');
const video = (id: string) =>
  ({
    id,
    public_id: `pub-${id}`,
    storage_key: `videos/pub-${id}/original`,
    upload_id: `up-${id}`,
  }) as Video;

describe('UploadReaperHandler', () => {
  let videos: { find: jest.Mock; delete: jest.Mock };
  let storage: { abortMultipartUpload: jest.Mock };
  let queue: { work: jest.Mock; schedule: jest.Mock };
  let handler: UploadReaperHandler;

  beforeEach(() => {
    videos = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    storage = { abortMultipartUpload: jest.fn().mockResolvedValue(undefined) };
    queue = {
      work: jest.fn().mockResolvedValue(undefined),
      schedule: jest.fn().mockResolvedValue(undefined),
    };
    handler = new UploadReaperHandler(
      videos as unknown as Repository<Video>,
      storage as unknown as StorageService,
      queue as unknown as QueueService,
    );
  });

  it('should register the worker and schedule the recurring job on bootstrap', async () => {
    await handler.onApplicationBootstrap();

    expect(queue.work).toHaveBeenCalledWith(
      'video.upload.reap',
      expect.any(Function),
    );
    expect(queue.schedule).toHaveBeenCalledWith(
      'video.upload.reap',
      UPLOAD_REAP_CRON,
    );
  });

  it('should select only open uploads inactive beyond the limit', async () => {
    await handler.reap(NOW);

    const calls = videos.find.mock.calls as [
      [{ where: { status: string; updated_at: unknown } }],
    ];
    const { where } = calls[0][0];
    expect(where.status).toBe(VideoStatus.UPLOADING);
    expect(where.updated_at).toEqual(
      LessThan(new Date(NOW.getTime() - UPLOAD_INACTIVITY_LIMIT_MS)),
    );
  });

  it('should abort the multipart and delete the row of each abandoned upload', async () => {
    videos.find.mockResolvedValue([video('1'), video('2')]);

    await expect(handler.reap(NOW)).resolves.toBe(2);

    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
      'videos/pub-1/original',
      'up-1',
    );
    expect(videos.delete).toHaveBeenCalledWith({
      id: '1',
      status: VideoStatus.UPLOADING,
      upload_id: 'up-1',
    });
    expect(videos.delete).toHaveBeenCalledTimes(2);
  });

  it('should treat an already-aborted upload as done', async () => {
    videos.find.mockResolvedValue([video('1')]);
    storage.abortMultipartUpload.mockRejectedValue(
      Object.assign(new Error('gone'), { name: 'NoSuchUpload' }),
    );

    await expect(handler.reap(NOW)).resolves.toBe(1);

    expect(videos.delete).toHaveBeenCalled();
  });

  it('should keep the row and carry on when the storage fails for one video', async () => {
    videos.find.mockResolvedValue([video('1'), video('2')]);
    storage.abortMultipartUpload
      .mockRejectedValueOnce(new Error('storage down'))
      .mockResolvedValueOnce(undefined);

    await expect(handler.reap(NOW)).resolves.toBe(1);

    expect(videos.delete).toHaveBeenCalledTimes(1);
    expect(videos.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id: '2' }),
    );
  });
});
