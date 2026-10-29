import { QueryFailedError, Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  PartNumberOutOfRangeException,
  UnsupportedVideoTypeException,
  UploadIncompleteException,
  UploadNotInProgressException,
  VideoForbiddenException,
  VideoNotFoundException,
  VideoNotReadyException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import { VideoProcessingProducer } from '../queue/video-processing.producer';
import { MultipartUploadRejectedError } from '../storage/storage.errors';
import { StorageService } from '../storage/storage.service';
import type { InitUploadDto } from './dto/init-upload.dto';
import { Video } from './entities/video.entity';
import { VideoAccessPolicy } from './video-access.policy';
import { ProcessingStatus } from './video.enums';
import { VideosService } from './videos.service';

const STORAGE_CONFIG = {
  maxSizeBytes: 10 * 1024 * 1024 * 1024,
  partSizeBytes: 64 * 1024 * 1024,
  presignUploadTtlSeconds: 3600,
} as never;

const VALID_DTO: InitUploadDto = {
  originalFilename: 'Clip.MP4',
  contentType: 'video/mp4',
  sizeBytes: 1024 * 1024 * 1024,
};

function makeCollisionError(): QueryFailedError {
  const driverError = Object.assign(new Error('duplicate'), {
    code: '23505',
    detail: 'Key (public_id)=(abcdefghijk) already exists.',
  });
  return new QueryFailedError('INSERT', [], driverError);
}

function createdDraft(
  createMock: jest.Mock,
  callIndex: number,
): Partial<Video> {
  const calls = createMock.mock.calls as [Partial<Video>][];
  return calls[callIndex][0];
}

describe('VideosService.initUpload', () => {
  let videoRepository: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let channelsService: { findByUserId: jest.Mock };
  let storageService: { createMultipartUpload: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    videoRepository = {
      create: jest.fn((data: Partial<Video>) => ({ ...data }) as Video),
      save: jest.fn((video: Video) => Promise.resolve(video)),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    channelsService = {
      findByUserId: jest.fn().mockResolvedValue({ id: 'channel-1' }),
    };
    storageService = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
    };
    service = new VideosService(
      videoRepository as unknown as Repository<Video>,
      channelsService as unknown as ChannelsService,
      storageService as unknown as StorageService,
      {} as never,
      {} as never,
      STORAGE_CONFIG,
    );
  });

  it('should create the draft, open the multipart upload and return the part plan', async () => {
    const result = await service.initUpload('user-1', VALID_DTO);

    const created = createdDraft(videoRepository.create, 0);
    expect(created.channelId).toBe('channel-1');
    expect(created.processingStatus).toBe(ProcessingStatus.UPLOADING);
    expect(created.objectKey).toBe(`videos/${created.id}/original.mp4`);
    expect(created.sizeBytes).toBe(String(VALID_DTO.sizeBytes));
    expect(storageService.createMultipartUpload).toHaveBeenCalledWith(
      created.objectKey,
      'video/mp4',
    );
    expect(videoRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ uploadId: 'upload-1' }),
    );
    expect(result).toEqual({
      id: created.publicId,
      partSizeBytes: 64 * 1024 * 1024,
      partCount: 16,
      processingStatus: ProcessingStatus.UPLOADING,
    });
  });

  it('should round the part count up for sizes that are not a multiple of the part size', async () => {
    const result = await service.initUpload('user-1', {
      ...VALID_DTO,
      sizeBytes: 64 * 1024 * 1024 + 1,
    });

    expect(result.partCount).toBe(2);
  });

  it('should reject a size above the maximum without touching the database or storage', async () => {
    await expect(
      service.initUpload('user-1', {
        ...VALID_DTO,
        sizeBytes: 10 * 1024 * 1024 * 1024 + 1,
      }),
    ).rejects.toThrow(VideoTooLargeException);

    expect(channelsService.findByUserId).not.toHaveBeenCalled();
    expect(videoRepository.save).not.toHaveBeenCalled();
    expect(storageService.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('should accept exactly the maximum size', async () => {
    await expect(
      service.initUpload('user-1', {
        ...VALID_DTO,
        sizeBytes: 10 * 1024 * 1024 * 1024,
      }),
    ).resolves.toBeDefined();
  });

  it('should reject a content type outside the allowlist', async () => {
    await expect(
      service.initUpload('user-1', {
        ...VALID_DTO,
        contentType: 'application/pdf',
        originalFilename: 'doc.pdf',
      }),
    ).rejects.toThrow(UnsupportedVideoTypeException);
  });

  it('should reject a file extension that does not match the content type', async () => {
    await expect(
      service.initUpload('user-1', {
        ...VALID_DTO,
        originalFilename: 'clip.webm',
      }),
    ).rejects.toThrow(UnsupportedVideoTypeException);
  });

  it('should reject a filename without extension', async () => {
    await expect(
      service.initUpload('user-1', { ...VALID_DTO, originalFilename: 'clip' }),
    ).rejects.toThrow(UnsupportedVideoTypeException);
  });

  it('should retry with a new publicId when the first one collides', async () => {
    videoRepository.save
      .mockRejectedValueOnce(makeCollisionError())
      .mockImplementation((video: Video) => Promise.resolve(video));

    await service.initUpload('user-1', VALID_DTO);

    const firstId = createdDraft(videoRepository.create, 0).publicId;
    const secondId = createdDraft(videoRepository.create, 1).publicId;
    expect(videoRepository.create).toHaveBeenCalledTimes(2);
    expect(secondId).not.toBe(firstId);
    expect(storageService.createMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('should rethrow errors that are not a publicId collision', async () => {
    const error = new Error('connection lost');
    videoRepository.save.mockRejectedValueOnce(error);

    await expect(service.initUpload('user-1', VALID_DTO)).rejects.toBe(error);
    expect(videoRepository.create).toHaveBeenCalledTimes(1);
  });

  it('should give up after repeated publicId collisions', async () => {
    videoRepository.save.mockRejectedValue(makeCollisionError());

    await expect(service.initUpload('user-1', VALID_DTO)).rejects.toThrow(
      'collision',
    );
  });

  it('should remove the draft when the storage refuses to open the multipart upload', async () => {
    const error = new Error('storage down');
    storageService.createMultipartUpload.mockRejectedValueOnce(error);

    await expect(service.initUpload('user-1', VALID_DTO)).rejects.toBe(error);

    const created = createdDraft(videoRepository.create, 0);
    expect(videoRepository.delete).toHaveBeenCalledWith({ id: created.id });
  });

  it('should fail loudly when the authenticated user has no channel', async () => {
    channelsService.findByUserId.mockResolvedValueOnce(null);

    await expect(service.initUpload('user-1', VALID_DTO)).rejects.toThrow(
      'no channel',
    );
    expect(videoRepository.save).not.toHaveBeenCalled();
  });
});

describe('VideosService.signParts', () => {
  const OWNED_VIDEO = {
    id: 'video-1',
    publicId: 'abcdefghijk',
    channelId: 'channel-1',
    objectKey: 'videos/video-1/original.mp4',
    uploadId: 'upload-1',
    sizeBytes: String(1024 * 1024 * 1024),
    processingStatus: ProcessingStatus.UPLOADING,
  } as Video;

  let videoRepository: { findOneBy: jest.Mock };
  let channelsService: { findByUserId: jest.Mock };
  let storageService: { presignUploadPart: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    videoRepository = {
      findOneBy: jest.fn().mockResolvedValue({ ...OWNED_VIDEO }),
    };
    channelsService = {
      findByUserId: jest.fn().mockResolvedValue({ id: 'channel-1' }),
    };
    storageService = {
      presignUploadPart: jest.fn(
        (_key: string, _uploadId: string, partNumber: number) =>
          Promise.resolve(`https://storage.test/part-${partNumber}`),
      ),
    };
    service = new VideosService(
      videoRepository as unknown as Repository<Video>,
      channelsService as unknown as ChannelsService,
      storageService as unknown as StorageService,
      {} as never,
      {} as never,
      STORAGE_CONFIG,
    );
  });

  it('should sign every requested part with the stored key and uploadId', async () => {
    const result = await service.signParts('user-1', 'abcdefghijk', {
      partNumbers: [1, 2],
    });

    expect(videoRepository.findOneBy).toHaveBeenCalledWith({
      publicId: 'abcdefghijk',
    });
    expect(storageService.presignUploadPart).toHaveBeenCalledWith(
      'videos/video-1/original.mp4',
      'upload-1',
      1,
    );
    expect(result).toEqual({
      parts: [
        { partNumber: 1, url: 'https://storage.test/part-1' },
        { partNumber: 2, url: 'https://storage.test/part-2' },
      ],
      expiresInSeconds: 3600,
    });
  });

  it('should sign a repeated part number only once', async () => {
    const result = await service.signParts('user-1', 'abcdefghijk', {
      partNumbers: [3, 3, 3],
    });

    expect(result.parts).toHaveLength(1);
    expect(storageService.presignUploadPart).toHaveBeenCalledTimes(1);
  });

  it('should accept the last part number and reject the one after it', async () => {
    await expect(
      service.signParts('user-1', 'abcdefghijk', { partNumbers: [16] }),
    ).resolves.toBeDefined();

    await expect(
      service.signParts('user-1', 'abcdefghijk', { partNumbers: [17] }),
    ).rejects.toThrow(PartNumberOutOfRangeException);
  });

  it('should throw VideoNotFoundException for an unknown publicId', async () => {
    videoRepository.findOneBy.mockResolvedValueOnce(null);

    await expect(
      service.signParts('user-1', 'unknownid01', { partNumbers: [1] }),
    ).rejects.toThrow(VideoNotFoundException);
    expect(channelsService.findByUserId).not.toHaveBeenCalled();
  });

  it('should throw VideoForbiddenException when the video belongs to another channel', async () => {
    channelsService.findByUserId.mockResolvedValueOnce({ id: 'channel-2' });

    await expect(
      service.signParts('user-2', 'abcdefghijk', { partNumbers: [1] }),
    ).rejects.toThrow(VideoForbiddenException);
    expect(storageService.presignUploadPart).not.toHaveBeenCalled();
  });

  it('should throw VideoForbiddenException when the caller has no channel', async () => {
    channelsService.findByUserId.mockResolvedValueOnce(null);

    await expect(
      service.signParts('user-2', 'abcdefghijk', { partNumbers: [1] }),
    ).rejects.toThrow(VideoForbiddenException);
  });

  it.each([
    ProcessingStatus.PROCESSING,
    ProcessingStatus.READY,
    ProcessingStatus.FAILED,
  ])(
    'should throw UploadNotInProgressException when the video is %s',
    async (status) => {
      videoRepository.findOneBy.mockResolvedValueOnce({
        ...OWNED_VIDEO,
        processingStatus: status,
      });

      await expect(
        service.signParts('user-1', 'abcdefghijk', { partNumbers: [1] }),
      ).rejects.toThrow(UploadNotInProgressException);
      expect(storageService.presignUploadPart).not.toHaveBeenCalled();
    },
  );

  it('should throw UploadNotInProgressException when the multipart uploadId is gone', async () => {
    videoRepository.findOneBy.mockResolvedValueOnce({
      ...OWNED_VIDEO,
      uploadId: null,
    });

    await expect(
      service.signParts('user-1', 'abcdefghijk', { partNumbers: [1] }),
    ).rejects.toThrow(UploadNotInProgressException);
  });
});

describe('VideosService.completeUpload', () => {
  const UPLOADING_VIDEO = {
    id: 'video-1',
    publicId: 'abcdefghijk',
    channelId: 'channel-1',
    objectKey: 'videos/video-1/original.mp4',
    uploadId: 'upload-1',
    sizeBytes: '1000',
    failureReason: null,
    processingStatus: ProcessingStatus.UPLOADING,
  } as Video;
  const PARTS = [{ partNumber: 1, etag: '"etag-1"' }];

  let videoRepository: { findOneBy: jest.Mock; save: jest.Mock };
  let channelsService: { findByUserId: jest.Mock };
  let storageService: {
    completeMultipartUpload: jest.Mock;
    headObject: jest.Mock;
  };
  let producer: { enqueueProcessVideo: jest.Mock };
  let service: VideosService;

  function stubVideo(overrides: Partial<Video> = {}): void {
    videoRepository.findOneBy.mockResolvedValue({
      ...UPLOADING_VIDEO,
      ...overrides,
    });
  }

  beforeEach(() => {
    videoRepository = {
      findOneBy: jest.fn(),
      save: jest.fn((video: Video) => Promise.resolve(video)),
    };
    stubVideo();
    channelsService = {
      findByUserId: jest.fn().mockResolvedValue({ id: 'channel-1' }),
    };
    storageService = {
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      headObject: jest.fn().mockResolvedValue({ contentLength: 1000 }),
    };
    producer = { enqueueProcessVideo: jest.fn().mockResolvedValue(undefined) };
    service = new VideosService(
      videoRepository as unknown as Repository<Video>,
      channelsService as unknown as ChannelsService,
      storageService as unknown as StorageService,
      producer as unknown as VideoProcessingProducer,
      {} as never,
      STORAGE_CONFIG,
    );
  });

  it('should complete the upload, move the video to PROCESSING and enqueue the job', async () => {
    const result = await service.completeUpload('user-1', 'abcdefghijk', {
      parts: PARTS,
    });

    expect(storageService.completeMultipartUpload).toHaveBeenCalledWith(
      'videos/video-1/original.mp4',
      'upload-1',
      PARTS,
    );
    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        processingStatus: ProcessingStatus.PROCESSING,
        uploadId: null,
      }),
    );
    expect(producer.enqueueProcessVideo).toHaveBeenCalledWith('video-1');
    expect(result).toEqual({
      id: 'abcdefghijk',
      processingStatus: ProcessingStatus.PROCESSING,
    });
  });

  it('should persist PROCESSING before enqueueing the job', async () => {
    const order: string[] = [];
    videoRepository.save.mockImplementation((video: Video) => {
      order.push('save');
      return Promise.resolve(video);
    });
    producer.enqueueProcessVideo.mockImplementation(() => {
      order.push('enqueue');
      return Promise.resolve();
    });

    await service.completeUpload('user-1', 'abcdefghijk', { parts: PARTS });

    expect(order).toEqual(['save', 'enqueue']);
  });

  it('should not touch storage again when the video is already PROCESSING but re-publish the job idempotently', async () => {
    stubVideo({
      processingStatus: ProcessingStatus.PROCESSING,
      uploadId: null,
    });

    const result = await service.completeUpload('user-1', 'abcdefghijk', {
      parts: PARTS,
    });

    expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
    expect(videoRepository.save).not.toHaveBeenCalled();
    expect(producer.enqueueProcessVideo).toHaveBeenCalledWith('video-1');
    expect(result.processingStatus).toBe(ProcessingStatus.PROCESSING);
  });

  it.each([ProcessingStatus.READY, ProcessingStatus.FAILED])(
    'should return the current state without enqueueing when the video is %s',
    async (status) => {
      stubVideo({ processingStatus: status, uploadId: null });

      const result = await service.completeUpload('user-1', 'abcdefghijk', {
        parts: PARTS,
      });

      expect(result.processingStatus).toBe(status);
      expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
      expect(producer.enqueueProcessVideo).not.toHaveBeenCalled();
    },
  );

  it('should mark the video FAILED and throw UploadIncompleteException when the stored size differs', async () => {
    storageService.headObject.mockResolvedValueOnce({ contentLength: 400 });

    await expect(
      service.completeUpload('user-1', 'abcdefghijk', { parts: PARTS }),
    ).rejects.toThrow(UploadIncompleteException);

    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        processingStatus: ProcessingStatus.FAILED,
        uploadId: null,
        failureReason: expect.stringContaining('size') as string,
      }),
    );
    expect(producer.enqueueProcessVideo).not.toHaveBeenCalled();
  });

  it('should treat a missing stored object like a size mismatch', async () => {
    storageService.headObject.mockResolvedValueOnce(null);

    await expect(
      service.completeUpload('user-1', 'abcdefghijk', { parts: PARTS }),
    ).rejects.toThrow(UploadIncompleteException);

    expect(producer.enqueueProcessVideo).not.toHaveBeenCalled();
  });

  it('should leave the video UPLOADING when the storage rejects the part list', async () => {
    storageService.completeMultipartUpload.mockRejectedValueOnce(
      new MultipartUploadRejectedError('InvalidPart'),
    );

    await expect(
      service.completeUpload('user-1', 'abcdefghijk', { parts: PARTS }),
    ).rejects.toThrow(UploadIncompleteException);

    expect(videoRepository.save).not.toHaveBeenCalled();
    expect(producer.enqueueProcessVideo).not.toHaveBeenCalled();
  });

  it('should rethrow unexpected storage errors without changing the video', async () => {
    const error = new Error('storage down');
    storageService.completeMultipartUpload.mockRejectedValueOnce(error);

    await expect(
      service.completeUpload('user-1', 'abcdefghijk', { parts: PARTS }),
    ).rejects.toBe(error);

    expect(videoRepository.save).not.toHaveBeenCalled();
  });

  it('should keep the video PROCESSING when the enqueue fails so a retry can republish', async () => {
    const error = new Error('redis down');
    producer.enqueueProcessVideo.mockRejectedValueOnce(error);

    await expect(
      service.completeUpload('user-1', 'abcdefghijk', { parts: PARTS }),
    ).rejects.toBe(error);

    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        processingStatus: ProcessingStatus.PROCESSING,
      }),
    );
  });

  it('should throw VideoNotFoundException for an unknown publicId', async () => {
    videoRepository.findOneBy.mockResolvedValue(null);

    await expect(
      service.completeUpload('user-1', 'unknownid01', { parts: PARTS }),
    ).rejects.toThrow(VideoNotFoundException);
  });

  it('should throw VideoForbiddenException when the video belongs to another channel', async () => {
    channelsService.findByUserId.mockResolvedValueOnce({ id: 'channel-2' });

    await expect(
      service.completeUpload('user-2', 'abcdefghijk', { parts: PARTS }),
    ).rejects.toThrow(VideoForbiddenException);

    expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
    expect(producer.enqueueProcessVideo).not.toHaveBeenCalled();
  });
});

describe('VideosService.getStreamUrl', () => {
  let videoRepository: { findOneBy: jest.Mock };
  let storageService: { presignGet: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    videoRepository = { findOneBy: jest.fn() };
    storageService = {
      presignGet: jest.fn().mockResolvedValue('https://storage.test/signed'),
    };
    service = new VideosService(
      videoRepository as unknown as Repository<Video>,
      {} as never,
      storageService as unknown as StorageService,
      {} as never,
      new VideoAccessPolicy(),
      STORAGE_CONFIG,
    );
  });

  it('should presign the stored object of a READY video', async () => {
    videoRepository.findOneBy.mockResolvedValue({
      objectKey: 'videos/video-1/original.mp4',
      processingStatus: ProcessingStatus.READY,
    });

    const url = await service.getStreamUrl('abcdefghijk');

    expect(videoRepository.findOneBy).toHaveBeenCalledWith({
      publicId: 'abcdefghijk',
    });
    expect(storageService.presignGet).toHaveBeenCalledWith(
      'videos/video-1/original.mp4',
    );
    expect(url).toBe('https://storage.test/signed');
  });

  it('should throw VideoNotFoundException for an unknown publicId', async () => {
    videoRepository.findOneBy.mockResolvedValue(null);

    await expect(service.getStreamUrl('unknownid01')).rejects.toThrow(
      VideoNotFoundException,
    );
    expect(storageService.presignGet).not.toHaveBeenCalled();
  });

  it.each([
    ProcessingStatus.UPLOADING,
    ProcessingStatus.PROCESSING,
    ProcessingStatus.FAILED,
  ])(
    'should throw VideoNotReadyException when the video is %s',
    async (status) => {
      videoRepository.findOneBy.mockResolvedValue({
        objectKey: 'videos/video-1/original.mp4',
        processingStatus: status,
      });

      await expect(service.getStreamUrl('abcdefghijk')).rejects.toThrow(
        VideoNotReadyException,
      );
      expect(storageService.presignGet).not.toHaveBeenCalled();
    },
  );

  it('should defer the decision to the access policy', async () => {
    const policy = { canAccess: jest.fn().mockReturnValue(false) };
    service = new VideosService(
      videoRepository as unknown as Repository<Video>,
      {} as never,
      storageService as unknown as StorageService,
      {} as never,
      policy as unknown as VideoAccessPolicy,
      STORAGE_CONFIG,
    );
    videoRepository.findOneBy.mockResolvedValue({
      objectKey: 'k',
      processingStatus: ProcessingStatus.READY,
    });

    await expect(service.getStreamUrl('abcdefghijk')).rejects.toThrow(
      VideoNotReadyException,
    );
    expect(policy.canAccess).toHaveBeenCalledTimes(1);
  });
});

describe('VideosService.getDownloadUrl', () => {
  let videoRepository: { findOneBy: jest.Mock };
  let storageService: { presignGet: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    videoRepository = { findOneBy: jest.fn() };
    storageService = {
      presignGet: jest.fn().mockResolvedValue('https://storage.test/download'),
    };
    service = new VideosService(
      videoRepository as unknown as Repository<Video>,
      {} as never,
      storageService as unknown as StorageService,
      {} as never,
      new VideoAccessPolicy(),
      STORAGE_CONFIG,
    );
  });

  it('should presign the object asking for the original file name as the download name', async () => {
    videoRepository.findOneBy.mockResolvedValue({
      objectKey: 'videos/video-1/original.mp4',
      originalFilename: 'My Clip.mp4',
      processingStatus: ProcessingStatus.READY,
    });

    const url = await service.getDownloadUrl('abcdefghijk');

    expect(storageService.presignGet).toHaveBeenCalledWith(
      'videos/video-1/original.mp4',
      { downloadFilename: 'My Clip.mp4' },
    );
    expect(url).toBe('https://storage.test/download');
  });

  it('should throw VideoNotFoundException for an unknown publicId', async () => {
    videoRepository.findOneBy.mockResolvedValue(null);

    await expect(service.getDownloadUrl('unknownid01')).rejects.toThrow(
      VideoNotFoundException,
    );
  });

  it.each([
    ProcessingStatus.UPLOADING,
    ProcessingStatus.PROCESSING,
    ProcessingStatus.FAILED,
  ])(
    'should throw VideoNotReadyException when the video is %s',
    async (status) => {
      videoRepository.findOneBy.mockResolvedValue({
        objectKey: 'k',
        originalFilename: 'a.mp4',
        processingStatus: status,
      });

      await expect(service.getDownloadUrl('abcdefghijk')).rejects.toThrow(
        VideoNotReadyException,
      );
      expect(storageService.presignGet).not.toHaveBeenCalled();
    },
  );
});
