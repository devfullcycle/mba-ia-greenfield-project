import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { PassThrough, Readable } from 'node:stream';
import { VideoStatus } from './entities/video.entity';
import { VideosController } from './videos.controller';

describe('VideosController (unit)', () => {
  let videosService: {
    initiateUpload: jest.Mock;
    getPresignedPartUrl: jest.Mock;
    completeUpload: jest.Mock;
    abortUpload: jest.Mock;
    findBySlug: jest.Mock;
    getVideoStreamBySlug: jest.Mock;
    getVideoDownloadBySlug: jest.Mock;
    getThumbnailStreamBySlug: jest.Mock;
  };
  let controller: VideosController;

  beforeEach(() => {
    videosService = {
      initiateUpload: jest.fn(),
      getPresignedPartUrl: jest.fn(),
      completeUpload: jest.fn(),
      abortUpload: jest.fn(),
      findBySlug: jest.fn(),
      getVideoStreamBySlug: jest.fn(),
      getVideoDownloadBySlug: jest.fn(),
      getThumbnailStreamBySlug: jest.fn(),
    };
    controller = new VideosController(videosService as any);
  });

  it('initiateUpload delegates to videosService.initiateUpload with user.sub', async () => {
    const expected = {
      id: 'vid-1',
      slug: 'Slug1234567',
      status: VideoStatus.DRAFT,
      upload_id: 'up-1',
      storage_key: 'videos/vid-1/original.mp4',
      part_size: 10485760,
      total_parts: 1,
      presigned_urls: [],
    };
    videosService.initiateUpload.mockResolvedValueOnce(expected);

    const dto = {
      title: 'My Video',
      original_filename: 'v.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1024,
    };

    const result = await controller.initiateUpload(
      { sub: 'user-1', email: 'u@example.com' },
      dto,
    );

    expect(videosService.initiateUpload).toHaveBeenCalledWith('user-1', dto);
    expect(result).toBe(expected);
  });

  it('getPresignedPartUrl delegates to videosService.getPresignedPartUrl', async () => {
    videosService.getPresignedPartUrl.mockResolvedValueOnce({
      part_number: 2,
      upload_url: 'http://minio:9000/signed-2',
      expires_in: 3600,
    });

    const result = await controller.getPresignedPartUrl(
      { sub: 'user-1', email: 'u@example.com' },
      'vid-1',
      { part_number: 2 },
    );

    expect(videosService.getPresignedPartUrl).toHaveBeenCalledWith(
      'user-1',
      'vid-1',
      2,
    );
    expect(result.part_number).toBe(2);
  });

  it('completeUpload delegates to videosService.completeUpload', async () => {
    videosService.completeUpload.mockResolvedValueOnce({
      id: 'vid-1',
      slug: 'Slug1234567',
      status: VideoStatus.PROCESSING,
    });

    const result = await controller.completeUpload(
      { sub: 'user-1', email: 'u@example.com' },
      'vid-1',
      { parts: [{ part_number: 1, etag: '"e1"' }] },
    );

    expect(videosService.completeUpload).toHaveBeenCalledWith(
      'user-1',
      'vid-1',
      { parts: [{ part_number: 1, etag: '"e1"' }] },
    );
    expect(result.status).toBe(VideoStatus.PROCESSING);
  });

  it('streamVideo sets 206 Partial Content and Content-Range headers on ranged requests', async () => {
    const sourceStream = Readable.from(Buffer.from('0123456789'));
    videosService.getVideoStreamBySlug.mockResolvedValueOnce({
      isPartial: true,
      stream: sourceStream,
      contentType: 'video/mp4',
      contentLength: 10,
      contentRange: 'bytes 0-9/100',
      totalSizeBytes: 100,
    });

    const headers: Record<string, string> = {};
    let statusCode = 0;
    const resStream = new PassThrough() as PassThrough & {
      setHeader: jest.Mock;
      status: jest.Mock;
    };
    resStream.setHeader = jest.fn((k: string, v: string) => {
      headers[k] = v;
    });
    resStream.status = jest.fn((code: number) => {
      statusCode = code;
      return resStream;
    });

    await controller.streamVideo(
      'Slug1234567',
      'bytes=0-9',
      resStream as unknown as Response,
    );

    expect(statusCode).toBe(HttpStatus.PARTIAL_CONTENT);
    expect(headers['Accept-Ranges']).toBe('bytes');
    expect(headers['Content-Range']).toBe('bytes 0-9/100');
    expect(headers['Content-Length']).toBe('10');
    expect(headers['Content-Type']).toBe('video/mp4');
  });

  it('downloadVideo sets Content-Disposition attachment header and 200 OK', async () => {
    const sourceStream = Readable.from(Buffer.from('video-bytes'));
    videosService.getVideoDownloadBySlug.mockResolvedValueOnce({
      stream: sourceStream,
      contentType: 'video/mp4',
      contentLength: 11,
      filename: 'lecture.mp4',
    });

    const headers: Record<string, string> = {};
    let statusCode = 0;
    const resStream = new PassThrough() as PassThrough & {
      setHeader: jest.Mock;
      status: jest.Mock;
    };
    resStream.setHeader = jest.fn((k: string, v: string) => {
      headers[k] = v;
    });
    resStream.status = jest.fn((code: number) => {
      statusCode = code;
      return resStream;
    });

    await controller.downloadVideo(
      'Slug1234567',
      resStream as unknown as Response,
    );

    expect(statusCode).toBe(HttpStatus.OK);
    expect(headers['Content-Disposition']).toBe(
      'attachment; filename="lecture.mp4"',
    );
    expect(headers['Content-Type']).toBe('video/mp4');
  });
});
