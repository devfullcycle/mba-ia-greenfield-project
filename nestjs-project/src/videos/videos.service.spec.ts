import { Test } from '@nestjs/testing';
import { VideoNotFoundException } from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import type { Video, VideoStatus } from './entities/video.entity';
import { VideoPublicIdService } from './video-public-id.service';
import { VideosRepository } from './videos.repository';
import { VideosService } from './videos.service';

const OWNER = 'owner-id';
const OTHER = 'other-id';

describe('VideosService', () => {
  const videosRepository = { findByPublicIdWithChannel: jest.fn() };
  let service: VideosService;
  let publicId: string;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        VideoPublicIdService,
        {
          provide: videoConfig.KEY,
          useValue: {
            publicIdAlphabet: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456789',
            reconcilerEnabled: false,
          },
        },
        { provide: VideosRepository, useValue: videosRepository },
      ],
    }).compile();
    service = module.get(VideosService);
    publicId = module.get(VideoPublicIdService).encode(1);
  });

  const stored = (status: VideoStatus): Video =>
    ({ public_id: publicId, status, channel: { user_id: OWNER } }) as Video;

  describe('findVisible', () => {
    const viewers: [string, string | null][] = [
      ['anonymous', null],
      ['another user', OTHER],
    ];

    it.each(viewers)('should show a READY video to %s', async (_, viewer) => {
      videosRepository.findByPublicIdWithChannel.mockResolvedValue(
        stored('READY'),
      );

      await expect(service.findVisible(publicId, viewer)).resolves.toEqual(
        stored('READY'),
      );
    });

    const hidden: VideoStatus[] = ['DRAFT', 'PROCESSING', 'ERROR'];
    it.each(
      hidden.flatMap((status) =>
        viewers.map(([label, viewer]) => [status, label, viewer] as const),
      ),
    )('should hide a %s video from %s (404)', async (status, _, viewer) => {
      videosRepository.findByPublicIdWithChannel.mockResolvedValue(
        stored(status),
      );

      await expect(
        service.findVisible(publicId, viewer),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it.each<VideoStatus>(['DRAFT', 'PROCESSING', 'READY', 'ERROR'])(
      'should show a %s video to its owner',
      async (status) => {
        videosRepository.findByPublicIdWithChannel.mockResolvedValue(
          stored(status),
        );

        await expect(service.findVisible(publicId, OWNER)).resolves.toEqual(
          stored(status),
        );
      },
    );

    it('should throw VIDEO_NOT_FOUND for an unknown video', async () => {
      videosRepository.findByPublicIdWithChannel.mockResolvedValue(null);

      await expect(service.findVisible(publicId, OWNER)).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
    });

    it('should throw VIDEO_NOT_FOUND for an id that does not decode, without querying', async () => {
      await expect(
        service.findVisible('not a public id!', OWNER),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
      expect(videosRepository.findByPublicIdWithChannel).not.toHaveBeenCalled();
    });
  });
});
