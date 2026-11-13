import { Channel } from '../channels/entities/channel.entity';
import { VideosService } from './videos.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { StartUploadDto } from './dto/start-upload.dto';
import { Video } from './entities/video.entity';
import { VideoStatus } from './enums/video-status.enum';
import {
  VideoUploadForbiddenException,
  VideoUploadConflictException,
} from './videos.exceptions';

describe('VideosService', () => {
  const videoRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
  } as any;
  const channelRepository = {
    findOneBy: jest.fn(),
  } as any;
  const storageService = {
    ensureBucket: jest.fn(),
    initiateMultipartUpload: jest.fn(),
    getPresignedPartUrl: jest.fn(),
    abortMultipartUpload: jest.fn(),
    completeMultipartUpload: jest.fn(),
    getObject: jest.fn(),
    getObjectRange: jest.fn(),
    statObject: jest.fn(),
  } as any;
  const videoQueue = {
    add: jest.fn(),
  } as any;
  let service: VideosService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VideosService(
      videoRepository,
      channelRepository,
      storageService,
      videoQueue,
    );
  });

  it('creates a draft for the authenticated channel', async () => {
    const channel = { id: 'channel-1', user_id: 'user-1' } as Channel;
    const saved = { id: 'video-1', status: VideoStatus.DRAFT } as Video;
    channelRepository.findOneBy.mockResolvedValue(channel);
    videoRepository.create.mockReturnValue(saved);
    videoRepository.save.mockResolvedValue(saved);

    const dto = {
      title: 'Demo',
      mime_type: 'video/mp4',
      file_size: 100,
    } as CreateVideoDto;
    await expect(service.createVideo('user-1', dto)).resolves.toEqual({
      id: 'video-1',
      status: VideoStatus.DRAFT,
    });
    expect(videoRepository.save).toHaveBeenCalledWith(saved);
  });

  it('starts a multipart upload and changes the video to UPLOADING', async () => {
    const video = {
      id: 'video-1',
      status: VideoStatus.DRAFT,
      channel: { user_id: 'user-1' },
    } as Video;
    videoRepository.findOne.mockResolvedValue(video);
    storageService.initiateMultipartUpload.mockResolvedValue('upload-1');
    const saved = { ...video, upload_id: 'upload-1' };
    videoRepository.save.mockResolvedValue(saved);

    const dto = {
      mime_type: 'video/mp4',
      part_size: 5 * 1024 * 1024,
      total_parts: 1,
    };
    await expect(
      service.startUpload('user-1', 'video-1', dto),
    ).resolves.toEqual({
      id: 'video-1',
      upload_id: 'upload-1',
      status: VideoStatus.UPLOADING,
    });
    expect(storageService.ensureBucket).toHaveBeenCalled();
    expect(storageService.initiateMultipartUpload).toHaveBeenCalledWith(
      'videos/video-1/source',
      'video/mp4',
    );
    expect(video.status).toBe(VideoStatus.UPLOADING);
  });

  it('returns presigned URLs and removes duplicate part numbers', async () => {
    const video = {
      id: 'video-1',
      status: VideoStatus.UPLOADING,
      upload_id: 'upload-1',
      storage_key: 'videos/video-1/source',
      channel: { user_id: 'user-1' },
    } as Video;
    videoRepository.findOne.mockResolvedValue(video);
    storageService.getPresignedPartUrl
      .mockResolvedValueOnce('url-1')
      .mockResolvedValueOnce('url-2');

    const dto = { part_numbers: [1, 1, 2] };
    await expect(
      service.getPresignedParts('user-1', 'video-1', dto),
    ).resolves.toEqual({
      video_id: 'video-1',
      parts: [
        { part_number: 1, url: 'url-1' },
        { part_number: 2, url: 'url-2' },
      ],
    });
  });

  it('completes multipart upload and publishes a processing job', async () => {
    const video = {
      id: 'video-1',
      status: VideoStatus.UPLOADING,
      upload_id: 'upload-1',
      storage_key: 'videos/video-1/source',
      mime_type: 'video/mp4',
      channel: { user_id: 'user-1' },
    } as Video;
    videoRepository.findOne.mockResolvedValue(video);
    storageService.statObject.mockResolvedValue({ size: 42 });
    videoQueue.add.mockResolvedValue({ id: 'video-video-1' });

    const result = await service.completeUpload('user-1', 'video-1', {
      parts: [{ part: 1, etag: 'etag-1' }],
    });

    expect(storageService.completeMultipartUpload).toHaveBeenCalledWith(
      'videos/video-1/source',
      'upload-1',
      [{ part: 1, etag: 'etag-1' }],
    );
    expect(videoQueue.add).toHaveBeenCalledWith(
      'process-video',
      expect.objectContaining({ videoId: 'video-1' }),
      expect.objectContaining({ jobId: 'video-video-1', attempts: 3 }),
    );
    expect(video.status).toBe(VideoStatus.PROCESSING);
    expect(result).toEqual({
      id: 'video-1',
      status: VideoStatus.PROCESSING,
      queued: true,
    });
  });

  it('returns a partial byte range for a ready video', async () => {
    const video = {
      id: 'video-1',
      status: VideoStatus.READY,
      storage_key: 'videos/video-1/source',
      mime_type: 'video/mp4',
    } as Video;
    videoRepository.findOneBy.mockResolvedValue(video);
    storageService.statObject.mockResolvedValue({ size: 100, metaData: {} });
    const rangeStream = { pipe: jest.fn() };
    storageService.getObjectRange.mockResolvedValue(rangeStream);

    const result = await service.getStream('video-1', 'bytes=10-19');
    expect(result.statusCode).toBe(206);
    expect(result.headers['Content-Range']).toBe('bytes 10-19/100');
    expect(result.headers['Content-Length']).toBe(10);
    expect(storageService.getObjectRange).toHaveBeenCalledWith(
      'videos/video-1/source',
      10,
      10,
    );
  });

  it('rejects an invalid byte range', async () => {
    videoRepository.findOneBy.mockResolvedValue({
      id: 'video-1',
      status: VideoStatus.READY,
      storage_key: 'videos/video-1/source',
    });
    storageService.statObject.mockResolvedValue({ size: 10, metaData: {} });
    await expect(service.getStream('video-1', 'bytes=20-30')).rejects.toThrow(
      'Range Not Satisfiable',
    );
  });

  it('rejects operations from another channel owner', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'video-1',
      channel: { user_id: 'owner-1' },
    });

    await expect(
      service.startUpload('owner-2', 'video-1', {} as StartUploadDto),
    ).rejects.toBeInstanceOf(VideoUploadForbiddenException);
  });

  it('rejects starting an upload after processing has begun', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'video-1',
      status: VideoStatus.PROCESSING,
      channel: { user_id: 'user-1' },
    });

    await expect(
      service.startUpload('user-1', 'video-1', {} as StartUploadDto),
    ).rejects.toBeInstanceOf(VideoUploadConflictException);
  });
});
