import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitUploadDto } from './dto/init-upload.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initiate a video upload',
    description:
      'Pre-registers the video as a draft and starts a multipart upload. Returns the upload id and the part plan; no file bytes pass through the API.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created and multipart upload started',
    schema: {
      properties: {
        videoId: { type: 'string' },
        uploadId: { type: 'string' },
        partSize: { type: 'number' },
        partCount: { type: 'number' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'User has no channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitUploadDto,
  ) {
    return this.videosService.initUpload(user.sub, dto);
  }

  @Get(':publicId/upload-url')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get a presigned URL for an upload part',
    description:
      'Returns a presigned URL the client uses to PUT a single part directly to storage.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned part URL',
    schema: {
      properties: {
        partNumber: { type: 'number' },
        url: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not own this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in draft state',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getUploadUrl(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Query('partNumber', ParseIntPipe) partNumber: number,
  ) {
    return this.videosService.getPartUrl(user.sub, publicId, partNumber);
  }

  @Post(':publicId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Finalizes the multipart upload, transitions the video to processing, and enqueues background processing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed; processing enqueued',
    schema: {
      properties: {
        videoId: { type: 'string' },
        status: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not own this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in draft state',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.videosService.completeUpload(user.sub, publicId, dto);
  }

  @Public()
  @Get(':publicId')
  @ApiOperation({
    summary: 'Get video metadata and status',
    description:
      'Returns public metadata and the processing status of a video.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video metadata',
    schema: {
      properties: {
        videoId: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string' },
        durationSeconds: { type: 'number', nullable: true },
        hasThumbnail: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getMetadata(@Param('publicId') publicId: string) {
    return this.videosService.getPublicMetadata(publicId);
  }

  @Public()
  @Get(':publicId/stream')
  @ApiOperation({
    summary: 'Stream a video (range-based)',
    description:
      'Streams the video, honoring the HTTP Range header with 206 Partial Content. Storage credentials are never exposed.',
  })
  @ApiResponse({ status: 200, description: 'Full body (no Range header)' })
  @ApiResponse({ status: 206, description: 'Partial content (Range honored)' })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready for playback',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @Param('publicId') publicId: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, contentLength, contentType, contentRange } =
      await this.videosService.openStream(publicId, range);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(contentLength));
    if (range && contentRange) {
      res.setHeader('Content-Range', contentRange);
      res.status(HttpStatus.PARTIAL_CONTENT);
    } else {
      res.status(HttpStatus.OK);
    }

    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  @Public()
  @Get(':publicId/download')
  @ApiOperation({
    summary: 'Download the original video',
    description: 'Streams the full original file as an attachment.',
  })
  @ApiResponse({ status: 200, description: 'Full file as attachment' })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { object, filename } =
      await this.videosService.openDownload(publicId);

    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Content-Length', String(object.contentLength));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    res.on('close', () => object.stream.destroy());
    object.stream.pipe(res);
  }

  @Public()
  @Get(':publicId/thumbnail')
  @ApiOperation({
    summary: 'Get the video thumbnail',
    description: 'Returns the generated JPEG thumbnail for the video.',
  })
  @ApiResponse({ status: 200, description: 'JPEG thumbnail' })
  @ApiResponse({
    status: 404,
    description: 'Video or thumbnail not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async thumbnail(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, contentLength, contentType } =
      await this.videosService.openThumbnail(publicId);

    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Content-Length', String(contentLength));

    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
}
