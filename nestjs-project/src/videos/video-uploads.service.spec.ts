import { Test } from '@nestjs/testing';
import { ChannelsService } from '../channels/channels.service';
import {
  InvalidUploadPartsException,
  VideoNotFoundException,
  VideoNotInDraftException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { VideoProcessingQueue } from '../queue/video-processing.queue';
import { StorageInvalidPartsError } from '../storage/storage.errors';
import { StorageService } from '../storage/storage.service';
import type { Video, VideoStatus } from './entities/video.entity';
import { VideoPublicIdService } from './video-public-id.service';
import { VideoUploadsService } from './video-uploads.service';
import { VideosRepository } from './videos.repository';

const OWNER_ID = 'owner-user-id';

describe('VideoUploadsService', () => {
  const videosRepository = {
    findByPublicIdWithChannel: jest.fn(),
    transitionStatus: jest.fn(),
    deleteDraft: jest.fn(),
  };
  const storage = {
    completeMultipartUpload: jest.fn(),
    abortMultipartUpload: jest.fn(),
  };
  const processingQueue = { enqueue: jest.fn() };
  let service: VideoUploadsService;
  let publicIds: VideoPublicIdService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        VideoUploadsService,
        VideoPublicIdService,
        {
          provide: videoConfig.KEY,
          useValue: {
            publicIdAlphabet: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456789',
            reconcilerEnabled: false,
          },
        },
        { provide: VideosRepository, useValue: videosRepository },
        { provide: ChannelsService, useValue: {} },
        { provide: StorageService, useValue: storage },
        { provide: VideoProcessingQueue, useValue: processingQueue },
      ],
    }).compile();
    service = module.get(VideoUploadsService);
    publicIds = module.get(VideoPublicIdService);
  });

  const videoWith = (status: VideoStatus, ownerId = OWNER_ID): Video =>
    ({
      id: 'video-uuid',
      status,
      channel: { user_id: ownerId },
    }) as Video;

  describe('findOwnedDraft', () => {
    it('should throw VIDEO_NOT_FOUND for an id that does not decode, without querying', async () => {
      await expect(
        service.findOwnedDraft('not a public id!', OWNER_ID),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
      expect(videosRepository.findByPublicIdWithChannel).not.toHaveBeenCalled();
    });

    it('should throw VIDEO_NOT_FOUND when the video does not exist', async () => {
      videosRepository.findByPublicIdWithChannel.mockResolvedValue(null);

      await expect(
        service.findOwnedDraft(publicIds.encode(1), OWNER_ID),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it('should throw VIDEO_NOT_FOUND (not 403) when the video belongs to another user', async () => {
      videosRepository.findByPublicIdWithChannel.mockResolvedValue(
        videoWith('DRAFT', 'someone-else'),
      );

      await expect(
        service.findOwnedDraft(publicIds.encode(1), OWNER_ID),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it.each<VideoStatus>(['PROCESSING', 'READY', 'ERROR'])(
      'should throw VIDEO_NOT_IN_DRAFT for an owned video in %s',
      async (status) => {
        videosRepository.findByPublicIdWithChannel.mockResolvedValue(
          videoWith(status),
        );

        await expect(
          service.findOwnedDraft(publicIds.encode(1), OWNER_ID),
        ).rejects.toBeInstanceOf(VideoNotInDraftException);
      },
    );

    it('should return the owned DRAFT video', async () => {
      const video = videoWith('DRAFT');
      videosRepository.findByPublicIdWithChannel.mockResolvedValue(video);

      await expect(
        service.findOwnedDraft(publicIds.encode(1), OWNER_ID),
      ).resolves.toBe(video);
    });
  });

  describe('complete', () => {
    const parts = [{ part_number: 1, etag: '"etag-1"' }];
    let publicId: string;

    beforeEach(() => {
      publicId = publicIds.encode(1);
      videosRepository.findByPublicIdWithChannel.mockResolvedValue({
        ...videoWith('DRAFT'),
        storage_key: 'videos/video-uuid/source',
        upload_id: 'upload-id',
      });
      videosRepository.transitionStatus.mockResolvedValue(true);
    });

    it('should persist PROCESSING before enqueuing the processing job', async () => {
      const calls: string[] = [];
      videosRepository.transitionStatus.mockImplementation(() => {
        calls.push('transition');
        return Promise.resolve(true);
      });
      processingQueue.enqueue.mockImplementation(() => {
        calls.push('enqueue');
        return Promise.resolve();
      });

      const result = await service.complete(publicId, OWNER_ID, { parts });

      expect(calls).toEqual(['transition', 'enqueue']);
      expect(videosRepository.transitionStatus).toHaveBeenCalledWith(
        'video-uuid',
        'DRAFT',
        'PROCESSING',
      );
      expect(processingQueue.enqueue).toHaveBeenCalledWith('video-uuid');
      expect(result).toEqual({ id: publicId, status: 'PROCESSING' });
    });

    it('should still resolve PROCESSING when enqueuing fails', async () => {
      processingQueue.enqueue.mockRejectedValue(new Error('redis down'));

      await expect(
        service.complete(publicId, OWNER_ID, { parts }),
      ).resolves.toEqual({ id: publicId, status: 'PROCESSING' });
    });

    it('should map rejected parts to INVALID_UPLOAD_PARTS without changing status or enqueuing', async () => {
      storage.completeMultipartUpload.mockRejectedValue(
        new StorageInvalidPartsError(),
      );

      await expect(
        service.complete(publicId, OWNER_ID, { parts }),
      ).rejects.toBeInstanceOf(InvalidUploadPartsException);
      expect(videosRepository.transitionStatus).not.toHaveBeenCalled();
      expect(processingQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should throw VIDEO_NOT_IN_DRAFT when a concurrent request already moved the video', async () => {
      videosRepository.transitionStatus.mockResolvedValue(false);

      await expect(
        service.complete(publicId, OWNER_ID, { parts }),
      ).rejects.toBeInstanceOf(VideoNotInDraftException);
      expect(processingQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('abort', () => {
    let publicId: string;

    beforeEach(() => {
      publicId = publicIds.encode(1);
      videosRepository.findByPublicIdWithChannel.mockResolvedValue({
        ...videoWith('DRAFT'),
        storage_key: 'videos/video-uuid/source',
        upload_id: 'upload-id',
      });
      storage.abortMultipartUpload.mockResolvedValue(undefined);
      videosRepository.deleteDraft.mockResolvedValue(true);
    });

    it('should abort the multipart upload before deleting the DRAFT row', async () => {
      const calls: string[] = [];
      storage.abortMultipartUpload.mockImplementation(() => {
        calls.push('abort');
        return Promise.resolve();
      });
      videosRepository.deleteDraft.mockImplementation(() => {
        calls.push('delete');
        return Promise.resolve(true);
      });

      await expect(service.abort(publicId, OWNER_ID)).resolves.toBeUndefined();

      expect(calls).toEqual(['abort', 'delete']);
      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        'videos/video-uuid/source',
        'upload-id',
      );
      expect(videosRepository.deleteDraft).toHaveBeenCalledWith('video-uuid');
    });

    it('should throw VIDEO_NOT_IN_DRAFT when a concurrent complete moved the video before the delete', async () => {
      videosRepository.deleteDraft.mockResolvedValue(false);

      await expect(service.abort(publicId, OWNER_ID)).rejects.toBeInstanceOf(
        VideoNotInDraftException,
      );
    });

    it('should delete the row when storage reports the multipart upload already gone', async () => {
      // StorageService.abortMultipartUpload resolves for a missing upload (idempotent).
      storage.abortMultipartUpload.mockResolvedValue(undefined);

      await service.abort(publicId, OWNER_ID);

      expect(videosRepository.deleteDraft).toHaveBeenCalledWith('video-uuid');
    });

    it('should keep the row for a retry when storage fails', async () => {
      storage.abortMultipartUpload.mockRejectedValue(new Error('minio down'));

      await expect(service.abort(publicId, OWNER_ID)).rejects.toThrow(
        'minio down',
      );
      expect(videosRepository.deleteDraft).not.toHaveBeenCalled();
    });
  });
});
