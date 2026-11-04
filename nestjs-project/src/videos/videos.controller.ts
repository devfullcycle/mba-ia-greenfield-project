import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { PresignPartDto } from './dto/presign-part.dto';
import {
  InitiateUploadResponse,
  VideoPublicDetails,
  VideosService,
} from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('uploads/init')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initiate a multipart video upload and pre-register draft',
    description:
      'Atomically creates a video record in draft status with a unique slug, initiates an S3 multipart upload (supporting up to 10GB), and returns presigned part URLs.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft video registered and multipart upload initiated',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        slug: { type: 'string', example: 'dQw4w9WgXcQ' },
        status: { type: 'string', enum: ['draft'] },
        upload_id: { type: 'string' },
        storage_key: { type: 'string' },
        part_size: { type: 'number' },
        total_parts: { type: 'number' },
        presigned_urls: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              part_number: { type: 'number' },
              upload_url: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or unsupported video format',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 413,
    description: 'Video file exceeds maximum allowed size of 10GB',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponse> {
    return this.videosService.initiateUpload(user.sub, dto);
  }

  @Post(':id/uploads/parts')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({
    summary: 'Generate a presigned upload URL for a specific multipart part',
    description:
      'Returns a presigned S3 PUT URL for the specified part number of an in-progress draft video upload.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned part URL generated',
    schema: {
      properties: {
        part_number: { type: 'number' },
        upload_url: { type: 'string' },
        expires_in: { type: 'number' },
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
    description: 'Not the owner of this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in draft status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getPresignedPartUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PresignPartDto,
  ): Promise<{ part_number: number; upload_url: string; expires_in: number }> {
    return this.videosService.getPresignedPartUrl(
      user.sub,
      id,
      dto.part_number,
    );
  }

  @Post(':id/uploads/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({
    summary: 'Complete video upload and enqueue background processing',
    description:
      'Finalizes the S3 multipart upload, transitions the video status from draft to processing, and enqueues the background FFmpeg job.',
  })
  @ApiResponse({
    status: 202,
    description: 'Upload completed and background processing queued',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        slug: { type: 'string' },
        status: { type: 'string', enum: ['processing'] },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Uploaded object missing in storage or validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Not the owner of this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in draft status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<{ id: string; slug: string; status: string }> {
    return this.videosService.completeUpload(user.sub, id, dto);
  }

  @Delete(':id/uploads/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({
    summary: 'Abort an in-progress draft video upload',
    description:
      'Aborts the S3 multipart upload and removes the draft video record.',
  })
  @ApiResponse({ status: 204, description: 'Upload aborted and draft deleted' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Not the owner of this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in draft status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.videosService.abortUpload(user.sub, id);
  }

  @Public()
  @Get(':slug')
  @ApiParam({ name: 'slug', type: 'string', example: 'dQw4w9WgXcQ' })
  @ApiOperation({
    summary: 'Get video metadata and status by unique slug',
    description:
      'Returns the video status, extracted FFprobe metadata (duration, dimensions, codec), and playback/download/thumbnail URLs.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video metadata returned',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findBySlug(@Param('slug') slug: string): Promise<VideoPublicDetails> {
    return this.videosService.findBySlug(slug);
  }

  @Public()
  @Get(':slug/stream')
  @ApiParam({ name: 'slug', type: 'string', example: 'dQw4w9WgXcQ' })
  @ApiHeader({
    name: 'Range',
    required: false,
    description: 'RFC 9110 byte range header (e.g., bytes=0-1048575)',
  })
  @ApiOperation({
    summary: 'Stream video content with HTTP Range (206 Partial Content)',
    description:
      'Streams a ready video without requiring full download. Supports RFC 9110 Range headers for partial content playback and seeking.',
  })
  @ApiResponse({
    status: 206,
    description: 'Partial video byte stream (Range request)',
  })
  @ApiResponse({
    status: 200,
    description: 'Full video stream (when Range header is omitted)',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready for streaming',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 416,
    description: 'Requested byte range is not satisfiable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async streamVideo(
    @Param('slug') slug: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const payload = await this.videosService.getVideoStreamBySlug(
      slug,
      rangeHeader,
    );

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', payload.contentType);
    res.setHeader('Content-Length', String(payload.contentLength));

    if (payload.isPartial && payload.contentRange) {
      res.setHeader('Content-Range', payload.contentRange);
      res.status(HttpStatus.PARTIAL_CONTENT);
    } else {
      res.status(HttpStatus.OK);
    }

    payload.stream.pipe(res);
  }

  @Public()
  @Get(':slug/download')
  @ApiParam({ name: 'slug', type: 'string', example: 'dQw4w9WgXcQ' })
  @ApiOperation({
    summary: 'Download full video file as an attachment',
    description:
      'Streams the complete video file with Content-Disposition: attachment.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video file attachment stream',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready for download',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async downloadVideo(
    @Param('slug') slug: string,
    @Res() res: Response,
  ): Promise<void> {
    const payload = await this.videosService.getVideoDownloadBySlug(slug);

    res.setHeader('Content-Type', payload.contentType);
    res.setHeader('Content-Length', String(payload.contentLength));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${payload.filename}"`,
    );
    res.status(HttpStatus.OK);

    payload.stream.pipe(res);
  }

  @Public()
  @Get(':slug/thumbnail')
  @ApiParam({ name: 'slug', type: 'string', example: 'dQw4w9WgXcQ' })
  @ApiOperation({
    summary: 'Get generated JPEG thumbnail for a ready video',
    description:
      'Streams the automatically extracted JPEG frame thumbnail from object storage.',
  })
  @ApiResponse({
    status: 200,
    description: 'JPEG thumbnail image stream',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready or thumbnail unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getThumbnail(
    @Param('slug') slug: string,
    @Res() res: Response,
  ): Promise<void> {
    const payload = await this.videosService.getThumbnailStreamBySlug(slug);

    res.setHeader('Content-Type', payload.contentType);
    res.setHeader('Content-Length', String(payload.contentLength));
    res.status(HttpStatus.OK);

    payload.stream.pipe(res);
  }
}
