import { Test } from '@nestjs/testing';
import { ChannelsService } from '../channels/channels.service';
import {
  VideoNotFoundException,
  VideoNotInDraftException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import type { Video, VideoStatus } from './entities/video.entity';
import { VideoPublicIdService } from './video-public-id.service';
import { VideoUploadsService } from './video-uploads.service';
import { VideosRepository } from './videos.repository';

const OWNER_ID = 'owner-user-id';

describe('VideoUploadsService', () => {
  const videosRepository = { findByPublicIdWithChannel: jest.fn() };
  let service: VideoUploadsService;
  let publicIds: VideoPublicIdService;

  beforeEach(async () => {
    videosRepository.findByPublicIdWithChannel.mockReset();
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
        { provide: StorageService, useValue: {} },
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
});
