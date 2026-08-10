import { Test, TestingModule } from '@nestjs/testing';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { VideoStatus } from './videos.constants';

const mockVideosService = {
  initiateUpload: jest.fn(),
  confirmUpload: jest.fn(),
  findById: jest.fn(),
  streamVideo: jest.fn(),
  downloadVideo: jest.fn(),
  listChannelVideos: jest.fn(),
  updateTitle: jest.fn(),
  deleteVideo: jest.fn(),
};

const mockUser = { sub: 'user-uuid', email: 'user@test.com' };

describe('VideosController', () => {
  let controller: VideosController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideosController],
      providers: [{ provide: VideosService, useValue: mockVideosService }],
    }).compile();

    controller = module.get(VideosController);
  });

  describe('initiateUpload (POST /videos)', () => {
    it('should return 201 payload with upload_url and storage_key', async () => {
      const expected = {
        id: 'v-uuid',
        status: VideoStatus.DRAFT,
        upload_url: 'https://presigned',
        storage_key: 'videos/v-uuid/original.mp4',
      };
      mockVideosService.initiateUpload.mockResolvedValue(expected);

      const result = await controller.initiateUpload(
        { title: 'Video', file_size: 1024, mime_type: 'video/mp4' },
        mockUser,
      );

      expect(result).toEqual(expected);
      expect(mockVideosService.initiateUpload).toHaveBeenCalledWith(
        'user-uuid',
        expect.any(Object),
      );
    });

    it('should extract userId from JWT sub', async () => {
      mockVideosService.initiateUpload.mockResolvedValue({});

      await controller.initiateUpload(
        { title: 'v', file_size: 1, mime_type: 'video/mp4' },
        mockUser,
      );

      expect(mockVideosService.initiateUpload).toHaveBeenCalledWith(
        'user-uuid',
        expect.any(Object),
      );
    });
  });

  describe('findById (GET /videos/:id)', () => {
    it('should return video public view', async () => {
      const expected = {
        id: 'v',
        title: 'Test',
        status: VideoStatus.READY,
        thumbnail_url: null,
        duration_seconds: 60,
        processing_metadata: null,
        channel_id: 'ch',
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockVideosService.findById.mockResolvedValue(expected);

      const result = await controller.findById('v');

      expect(result).toEqual(expected);
    });
  });

  describe('updateTitle (PATCH /videos/:id)', () => {
    it('should delegate to service with id and userId', async () => {
      const expected = {
        id: 'v',
        title: 'New',
        status: VideoStatus.DRAFT,
        updated_at: new Date(),
      };
      mockVideosService.updateTitle.mockResolvedValue(expected);

      const result = await controller.updateTitle(
        'v',
        { title: 'New' },
        mockUser,
      );

      expect(result).toEqual(expected);
      expect(mockVideosService.updateTitle).toHaveBeenCalledWith(
        'v',
        'user-uuid',
        { title: 'New' },
      );
    });
  });

  describe('deleteVideo (DELETE /videos/:id)', () => {
    it('should call service and return void', async () => {
      mockVideosService.deleteVideo.mockResolvedValue(undefined);

      await controller.deleteVideo('v', mockUser);

      expect(mockVideosService.deleteVideo).toHaveBeenCalledWith(
        'v',
        'user-uuid',
      );
    });
  });
});
