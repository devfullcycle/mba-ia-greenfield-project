import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  FileTooLargeException,
  UnsupportedVideoFormatException,
  UploadAlreadyCompletedException,
  UploadIncompleteException,
  VideoForbiddenException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { QUEUES } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { Video } from './entities/video.entity';
import {
  MAX_UPLOAD_PARTS,
  MAX_VIDEO_SIZE_BYTES,
  PART_SIZE_BYTES,
  PLAYBACK_URL_EXPIRES_IN_SECONDS,
  VideoStatus,
  VideoVisibility,
} from './videos.constants';
import { VideosService } from './videos.service';

const user = { sub: 'user-1', email: 'u@example.com' };
const dto = {
  filename: 'clip.mp4',
  size_bytes: 1024,
  content_type: 'video/mp4',
};

const collisionError = () =>
  new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('duplicate key'), {
      code: '23505',
      detail: 'Key (public_id)=(abc) already exists.',
    }),
  );

describe('VideosService', () => {
  let videos: jest.Mocked<
    Pick<Repository<Video>, 'create' | 'save' | 'delete' | 'findOne'>
  >;
  let channels: { findByUserId: jest.Mock };
  let storage: {
    createMultipartUpload: jest.Mock;
    presignUploadPart: jest.Mock;
    completeMultipartUpload: jest.Mock;
    presignGetUrl: jest.Mock;
  };
  let queue: { enqueue: jest.Mock };
  let manager: { update: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    videos = {
      create: jest.fn((input) => input as Video),
      save: jest.fn((video) => Promise.resolve({ id: 'vid-1', ...video })),
      delete: jest.fn(),
      findOne: jest.fn(),
    } as never;
    channels = {
      findByUserId: jest.fn().mockResolvedValue({ id: 'chan-1' }),
    };
    storage = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
      presignUploadPart: jest
        .fn()
        .mockImplementation((_k, _u, part: number) =>
          Promise.resolve(`https://storage/part-${part}`),
        ),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      presignGetUrl: jest.fn().mockResolvedValue('https://storage/get'),
    };
    queue = { enqueue: jest.fn().mockResolvedValue('job-1') };
    manager = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    dataSource = {
      transaction: jest.fn((cb: (m: unknown) => Promise<unknown>) =>
        cb(manager),
      ),
    };
    service = new VideosService(
      videos as unknown as Repository<Video>,
      channels as unknown as ChannelsService,
      storage as unknown as StorageService,
      queue as unknown as QueueService,
      dataSource as unknown as DataSource,
    );
  });

  describe('startUpload', () => {
    it('should reject sizes above 10GB without creating a video or an upload', async () => {
      await expect(
        service.startUpload(user, {
          ...dto,
          size_bytes: MAX_VIDEO_SIZE_BYTES + 1,
        }),
      ).rejects.toBeInstanceOf(FileTooLargeException);

      expect(videos.save).not.toHaveBeenCalled();
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('should accept exactly 10GB', async () => {
      await expect(
        service.startUpload(user, {
          ...dto,
          size_bytes: MAX_VIDEO_SIZE_BYTES,
        }),
      ).resolves.toBeDefined();
    });

    it('should reject an unsupported content type without creating a video', async () => {
      await expect(
        service.startUpload(user, { ...dto, content_type: 'image/png' }),
      ).rejects.toBeInstanceOf(UnsupportedVideoFormatException);

      expect(videos.save).not.toHaveBeenCalled();
    });

    it('should ignore case and media type parameters when matching the format', async () => {
      await service.startUpload(user, {
        ...dto,
        content_type: 'Video/MP4; codecs=avc1',
      });

      expect(storage.createMultipartUpload).toHaveBeenCalledWith(
        expect.stringMatching(/^videos\/.{11}\/original$/),
        'video/mp4',
      );
    });

    it('should return a part size that keeps a 10GB file under the 10,000-part limit and above 5MiB', async () => {
      const result = await service.startUpload(user, dto);

      expect(result.part_size_bytes).toBe(PART_SIZE_BYTES);
      expect(PART_SIZE_BYTES).toBeGreaterThanOrEqual(5 * 1024 * 1024);
      expect(Math.ceil(MAX_VIDEO_SIZE_BYTES / PART_SIZE_BYTES)).toBeLessThan(
        MAX_UPLOAD_PARTS,
      );
    });

    it('should retry with a new public_id on collision', async () => {
      videos.save.mockRejectedValueOnce(collisionError());

      const result = await service.startUpload(user, dto);

      expect(result.upload_id).toBe('upload-1');
      expect(videos.create).toHaveBeenCalledTimes(2);
    });

    it('should not retry on other database errors', async () => {
      videos.save.mockRejectedValueOnce(new Error('connection lost'));

      await expect(service.startUpload(user, dto)).rejects.toThrow(
        'connection lost',
      );
      expect(videos.create).toHaveBeenCalledTimes(1);
    });

    it('should remove the draft when the storage refuses to open the upload', async () => {
      storage.createMultipartUpload.mockRejectedValueOnce(
        new Error('storage down'),
      );

      await expect(service.startUpload(user, dto)).rejects.toThrow(
        'storage down',
      );
      expect(videos.delete).toHaveBeenCalledWith({ id: 'vid-1' });
    });
  });
  describe('signParts / completeUpload', () => {
    const openVideo = {
      id: 'vid-1',
      public_id: 'abcDEF12345',
      channel_id: 'chan-1',
      status: 'uploading',
      upload_id: 'upload-1',
      storage_key: 'videos/abcDEF12345/original',
    };
    const parts = [{ part_number: 1, etag: '"etag-1"' }];

    beforeEach(() => {
      videos.findOne.mockResolvedValue({ ...openVideo } as Video);
    });

    it('should sign one URL per requested part for the owner', async () => {
      const urls = await service.signParts(user, 'abcDEF12345', [1, 3]);

      expect(urls).toEqual([
        { part_number: 1, url: 'https://storage/part-1' },
        { part_number: 3, url: 'https://storage/part-3' },
      ]);
      expect(storage.presignUploadPart).toHaveBeenCalledWith(
        openVideo.storage_key,
        'upload-1',
        3,
      );
    });

    it('should throw VIDEO_NOT_FOUND for an unknown publicId', async () => {
      videos.findOne.mockResolvedValue(null);

      await expect(service.signParts(user, 'nope', [1])).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
    });

    it('should throw VIDEO_FORBIDDEN when the video belongs to another channel', async () => {
      channels.findByUserId.mockResolvedValue({ id: 'other-channel' });

      await expect(
        service.signParts(user, 'abcDEF12345', [1]),
      ).rejects.toBeInstanceOf(VideoForbiddenException);
      expect(storage.presignUploadPart).not.toHaveBeenCalled();
    });

    it('should throw UPLOAD_ALREADY_COMPLETED when signing or completing a closed upload', async () => {
      videos.findOne.mockResolvedValue({
        ...openVideo,
        status: 'processing',
        upload_id: null,
      } as Video);

      await expect(
        service.signParts(user, 'abcDEF12345', [1]),
      ).rejects.toBeInstanceOf(UploadAlreadyCompletedException);
      await expect(
        service.completeUpload(user, 'abcDEF12345', { parts }),
      ).rejects.toBeInstanceOf(UploadAlreadyCompletedException);
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    });

    it('should complete the multipart, mark the video as processing and enqueue video.process in the same transaction', async () => {
      const result = await service.completeUpload(user, 'abcDEF12345', {
        parts,
      });

      expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
        openVideo.storage_key,
        'upload-1',
        [{ partNumber: 1, etag: '"etag-1"' }],
      );
      expect(manager.update).toHaveBeenCalledWith(
        Video,
        { id: 'vid-1', status: 'uploading' },
        { status: 'processing', upload_id: null },
      );
      expect(queue.enqueue).toHaveBeenCalledWith(
        QUEUES.VIDEO_PROCESS,
        { videoId: 'vid-1' },
        { transaction: manager },
      );
      expect(result).toEqual({
        public_id: 'abcDEF12345',
        status: 'processing',
      });
    });

    it('should map a storage 4xx refusal to UPLOAD_INCOMPLETE without touching the video', async () => {
      storage.completeMultipartUpload.mockRejectedValue(
        Object.assign(new Error('InvalidPart'), {
          $metadata: { httpStatusCode: 400 },
        }),
      );

      await expect(
        service.completeUpload(user, 'abcDEF12345', { parts }),
      ).rejects.toBeInstanceOf(UploadIncompleteException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should rethrow storage failures that are not client errors', async () => {
      storage.completeMultipartUpload.mockRejectedValue(
        Object.assign(new Error('boom'), {
          $metadata: { httpStatusCode: 500 },
        }),
      );

      await expect(
        service.completeUpload(user, 'abcDEF12345', { parts }),
      ).rejects.toThrow('boom');
    });

    it('should throw UPLOAD_ALREADY_COMPLETED when a concurrent completion won the update', async () => {
      manager.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.completeUpload(user, 'abcDEF12345', { parts }),
      ).rejects.toBeInstanceOf(UploadAlreadyCompletedException);
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('getVideo / getPlaybackUrl', () => {
    const video = (overrides: Partial<Video> = {}) =>
      ({
        id: 'vid-1',
        public_id: 'abc',
        channel_id: 'chan-1',
        status: VideoStatus.READY,
        visibility: VideoVisibility.DRAFT,
        original_filename: 'clip.mp4',
        storage_key: 'videos/abc/original',
        thumbnail_key: null,
        duration_seconds: 12.5,
        metadata: { width: 640 },
        ...overrides,
      }) as Video;

    it('should return the draft to its owner', async () => {
      videos.findOne.mockResolvedValue(video());

      await expect(service.getVideo('abc', user)).resolves.toEqual({
        public_id: 'abc',
        status: VideoStatus.READY,
        visibility: VideoVisibility.DRAFT,
        duration_seconds: 12.5,
        metadata: { width: 640 },
        has_thumbnail: false,
      });
    });

    it('should hide a draft from anonymous viewers and from other channels', async () => {
      videos.findOne.mockResolvedValue(video());

      await expect(service.getVideo('abc')).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
      channels.findByUserId.mockResolvedValue({ id: 'chan-2' });
      await expect(service.getVideo('abc', user)).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
    });

    it('should show a published video to anonymous viewers', async () => {
      videos.findOne.mockResolvedValue(
        video({ visibility: VideoVisibility.PUBLISHED, thumbnail_key: 't' }),
      );

      const result = await service.getVideo('abc');

      expect(result.has_thumbnail).toBe(true);
      expect(channels.findByUserId).not.toHaveBeenCalled();
    });

    it('should throw VIDEO_NOT_FOUND for an unknown publicId', async () => {
      videos.findOne.mockResolvedValue(null);

      await expect(service.getVideo('nope', user)).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
    });

    it('should throw VIDEO_NOT_READY while the video is processing', async () => {
      videos.findOne.mockResolvedValue(
        video({ status: VideoStatus.PROCESSING }),
      );

      await expect(
        service.getPlaybackUrl('abc', user, { download: false }),
      ).rejects.toBeInstanceOf(VideoNotReadyException);
      expect(storage.presignGetUrl).not.toHaveBeenCalled();
    });

    it('should presign a download URL with the original filename', async () => {
      videos.findOne.mockResolvedValue(video());

      const result = await service.getPlaybackUrl('abc', user, {
        download: true,
      });

      expect(result).toEqual({
        url: 'https://storage/get',
        expires_in: PLAYBACK_URL_EXPIRES_IN_SECONDS,
      });
      expect(storage.presignGetUrl).toHaveBeenCalledWith(
        'videos/abc/original',
        {
          download: true,
          filename: 'clip.mp4',
          expiresIn: PLAYBACK_URL_EXPIRES_IN_SECONDS,
        },
      );
    });
  });
});
