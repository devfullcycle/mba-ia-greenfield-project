import { Test, TestingModule } from '@nestjs/testing';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { StorageService } from './services/storage.service';
import { VideoStatus } from './entities/video.entity';
import { JwtPayload } from '../auth/auth.types';
import storageConfig from '../config/storage.config';
import { Readable } from 'node:stream';
import { Response } from 'express';

describe('VideosController', () => {
  let controller: VideosController;

  const mockUser: JwtPayload = {
    sub: 'user-uuid',
    email: 'user@example.com',
  };

  const mockVideosService = {
    initiateUpload: jest.fn(),
    generatePresignedPartUrl: jest.fn(),
    completeUpload: jest.fn(),
    getVideoDetails: jest.fn(),
    findVideoByUrlId: jest.fn(),
  };

  const mockStorageService = {
    getObjectStream: jest.fn(),
  };

  const mockStatus = jest.fn().mockReturnThis();
  const mockSet = jest.fn().mockReturnThis();
  const mockResponse = {
    status: mockStatus,
    set: mockSet,
  } as unknown as Response;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideosController],
      providers: [
        {
          provide: VideosService,
          useValue: mockVideosService,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: storageConfig.KEY,
          useValue: {
            bucketVideos: 'videos-bucket',
            bucketThumbnails: 'thumbnails-bucket',
          },
        },
      ],
    }).compile();

    controller = module.get<VideosController>(VideosController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('initiateUpload', () => {
    it('should call service.initiateUpload', async () => {
      const dto = {
        title: 'Title',
        fileName: 'file.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 1000,
      };
      const response = {
        videoId: 'video-uuid',
        unique_url_id: 'nanoid123456',
        uploadId: 'upload-id',
        key: 'key',
      };
      mockVideosService.initiateUpload.mockResolvedValue(response);

      const result = await controller.initiateUpload(mockUser, dto);

      expect(result).toEqual(response);
      expect(mockVideosService.initiateUpload).toHaveBeenCalledWith(
        mockUser.sub,
        dto,
      );
    });
  });

  describe('generatePresignedPartUrl', () => {
    it('should call service.generatePresignedPartUrl', async () => {
      const dto = { partNumber: 1, uploadId: 'upload-id' };
      const response = { url: 'http://signed-url' };
      mockVideosService.generatePresignedPartUrl.mockResolvedValue(response);

      const result = await controller.generatePresignedPartUrl(
        'video-uuid',
        mockUser,
        dto,
      );

      expect(result).toEqual(response);
      expect(mockVideosService.generatePresignedPartUrl).toHaveBeenCalledWith(
        mockUser.sub,
        'video-uuid',
        dto,
      );
    });
  });

  describe('completeUpload', () => {
    it('should call service.completeUpload', async () => {
      const dto = {
        uploadId: 'upload-id',
        parts: [{ ETag: 'etag', PartNumber: 1 }],
      };
      const response = { success: true, status: VideoStatus.PROCESSING };
      mockVideosService.completeUpload.mockResolvedValue(response);

      const result = await controller.completeUpload(
        'video-uuid',
        mockUser,
        dto,
      );

      expect(result).toEqual(response);
      expect(mockVideosService.completeUpload).toHaveBeenCalledWith(
        mockUser.sub,
        'video-uuid',
        dto,
      );
    });
  });

  describe('getVideoDetails', () => {
    it('should call service.getVideoDetails', async () => {
      const response = {
        id: 'video-uuid',
        title: 'Title',
        description: null,
        unique_url_id: 'nanoid123456',
        status: VideoStatus.READY,
        failure_reason: null,
        duration: 10.5,
        size_bytes: 1000,
        channel_id: 'channel-uuid',
        created_at: new Date(),
        updated_at: new Date(),
        metadata: null,
      };
      mockVideosService.getVideoDetails.mockResolvedValue(response);

      const result = await controller.getVideoDetails('nanoid123456');

      expect(result).toEqual(response);
      expect(mockVideosService.getVideoDetails).toHaveBeenCalledWith(
        'nanoid123456',
      );
    });
  });

  describe('streamVideo', () => {
    it('should stream video successfully', async () => {
      const mockVideo = {
        id: 'vid-1',
        title: 'Title',
        video_key: 'videos/key.mp4',
        status: VideoStatus.READY,
      };
      mockVideosService.findVideoByUrlId.mockResolvedValue(mockVideo);

      const mockReadable = new Readable();
      mockReadable._read = () => {};
      const pipeSpy = jest
        .spyOn(mockReadable, 'pipe')
        .mockImplementation((dest) => dest);

      mockStorageService.getObjectStream.mockResolvedValue({
        stream: mockReadable,
        contentLength: 100,
        contentRange: 'bytes 0-99/100',
        acceptRanges: 'bytes',
        contentType: 'video/mp4',
      });

      await controller.streamVideo('url-id', 'bytes=0-99', mockResponse);

      expect(mockVideosService.findVideoByUrlId).toHaveBeenCalledWith('url-id');
      expect(mockStorageService.getObjectStream).toHaveBeenCalledWith(
        'videos-bucket',
        mockVideo.video_key,
        'bytes=0-99',
      );
      expect(mockStatus).toHaveBeenCalledWith(206);
      expect(mockSet).toHaveBeenCalledWith({
        'Content-Type': 'video/mp4',
        'Content-Length': 100,
        'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes 0-99/100',
      });
      expect(pipeSpy).toHaveBeenCalledWith(mockResponse);
    });
  });

  describe('downloadVideo', () => {
    it('should download video successfully', async () => {
      const mockVideo = {
        id: 'vid-1',
        title: 'My Video Title',
        video_key: 'videos/key.mp4',
        status: VideoStatus.READY,
      };
      mockVideosService.findVideoByUrlId.mockResolvedValue(mockVideo);

      const mockReadable = new Readable();
      mockReadable._read = () => {};
      const pipeSpy = jest
        .spyOn(mockReadable, 'pipe')
        .mockImplementation((dest) => dest);

      mockStorageService.getObjectStream.mockResolvedValue({
        stream: mockReadable,
        contentLength: 500,
      });

      await controller.downloadVideo('url-id', mockResponse);

      expect(mockVideosService.findVideoByUrlId).toHaveBeenCalledWith('url-id');
      expect(mockStorageService.getObjectStream).toHaveBeenCalledWith(
        'videos-bucket',
        mockVideo.video_key,
      );
      expect(mockSet).toHaveBeenCalledWith({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="My Video Title.mp4"',
        'Content-Length': 500,
      });
      expect(pipeSpy).toHaveBeenCalledWith(mockResponse);
    });
  });
});
