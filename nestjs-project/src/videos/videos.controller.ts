import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { UploadPartUrlsDto } from './dto/upload-part-urls.dto';
import type { VideoStatus } from './entities/video.entity';
import {
  InitiateUploadResult,
  UploadPartUrl,
  VideoMetadata,
  VideosService,
} from './videos.service';

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Initiate a video upload',
    description:
      'Pre-registers a video as a draft and opens a multipart upload targeting object storage.',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload initiated',
    schema: {
      properties: {
        id: { type: 'string', description: 'Short unique public video slug' },
        uploadId: { type: 'string' },
        key: { type: 'string' },
        status: { type: 'string', example: 'draft' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or file exceeds the 10GB upload limit',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ): Promise<InitiateUploadResult> {
    return this.videosService.initiateUpload(user.sub, dto);
  }

  @Post(':id/upload-part-urls')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get presigned part upload URLs',
    description:
      'Returns a presigned upload URL for each requested multipart upload part number.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned part URLs',
    schema: {
      properties: {
        urls: {
          type: 'array',
          items: {
            properties: {
              partNumber: { type: 'number' },
              url: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Video does not belong to the caller',
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
  async getUploadPartUrls(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UploadPartUrlsDto,
  ): Promise<{ urls: UploadPartUrl[] }> {
    const urls = await this.videosService.getUploadPartUrls(
      user.sub,
      id,
      dto.partNumbers,
    );
    return { urls };
  }

  @Post(':id/complete-upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Finalizes the multipart upload, transitions the video to processing, and enqueues background processing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed',
    schema: {
      properties: {
        id: { type: 'string', description: 'Short unique public video slug' },
        status: { type: 'string', example: 'processing' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Video does not belong to the caller',
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
  @ApiResponse({
    status: 502,
    description: 'Object storage rejected the multipart completion',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<{ id: string; status: VideoStatus }> {
    return this.videosService.completeUpload(user.sub, id, dto.parts);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get video metadata',
    description:
      "Returns the caller-owned video's current status and metadata.",
  })
  @ApiResponse({
    status: 200,
    description: 'Video metadata',
    schema: {
      properties: {
        id: { type: 'string', description: 'Short unique public video slug' },
        status: { type: 'string' },
        title: { type: 'string' },
        originalFilename: { type: 'string' },
        mimeType: { type: 'string' },
        sizeBytes: { type: 'string' },
        durationSeconds: { type: 'number', nullable: true },
        metadata: { type: 'object', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Video does not belong to the caller',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findById(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<VideoMetadata> {
    return this.videosService.findById(user.sub, id);
  }

  @Get(':id/stream')
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Redirects to a presigned URL for inline playback of a ready video.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to a presigned inline-disposition URL',
  })
  @ApiResponse({
    status: 403,
    description: 'Video does not belong to the caller',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
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
  async stream(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.videosService.getStreamUrl(user.sub, id);
    res.redirect(HttpStatus.FOUND, url);
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Download a video',
    description:
      'Redirects to a presigned URL for attachment download of a ready video.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to a presigned attachment-disposition URL',
  })
  @ApiResponse({
    status: 403,
    description: 'Video does not belong to the caller',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
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
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.videosService.getDownloadUrl(user.sub, id);
    res.redirect(HttpStatus.FOUND, url);
  }

  @Post(':id/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reprocess a failed video',
    description:
      'Clears the failure reason, transitions a failed video back to processing, and re-enqueues background processing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Reprocessing started',
    schema: {
      properties: {
        id: { type: 'string', description: 'Short unique public video slug' },
        status: { type: 'string', example: 'processing' },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Video does not belong to the caller',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in failed status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async reprocess(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ id: string; status: VideoStatus }> {
    return this.videosService.reprocess(user.sub, id);
  }
}
