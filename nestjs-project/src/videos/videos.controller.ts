import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { UploadCompleteDto } from './dto/upload-complete.dto';
import {
  CreateDraftResult,
  PresignedUrlResult,
  VideoDetails,
  VideosService,
} from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Create a video draft',
    description:
      "Creates a video draft for the authenticated user's channel and initiates an S3 multipart upload, returning pre-signed part URLs.",
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created and multipart upload initiated',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        slug: { type: 'string' },
        storage_key: { type: 'string' },
        parts: {
          type: 'array',
          items: {
            properties: {
              part_number: { type: 'integer' },
              upload_url: { type: 'string' },
            },
          },
        },
        part_size: { type: 'integer' },
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
    description: 'Authenticated user has no channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<CreateDraftResult> {
    return this.videosService.createDraft(user.sub, dto);
  }

  @Post(':id/upload-complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Finalizes the S3 multipart upload for a draft video and publishes a processing job.',
  })
  @ApiResponse({ status: 204, description: 'Upload completed' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Video does not belong to the authenticated user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video status does not allow this operation',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async uploadComplete(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UploadCompleteDto,
  ): Promise<void> {
    return this.videosService.markUploadComplete(id, user.sub, dto);
  }

  @Get(':slug/stream-url')
  @Public()
  @ApiOperation({
    summary: 'Get a video streaming URL',
    description:
      'Returns a pre-signed GET URL pointing to the video object; MinIO/S3 handles HTTP range requests natively.',
  })
  @ApiResponse({
    status: 200,
    description: 'Pre-signed streaming URL',
    schema: {
      properties: {
        url: { type: 'string' },
        expires_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready for playback yet',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getStreamUrl(@Param('slug') slug: string): Promise<PresignedUrlResult> {
    return this.videosService.getStreamUrl(slug);
  }

  @Get(':slug/download-url')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get a video download URL',
    description:
      'Returns a pre-signed GET URL with a Content-Disposition: attachment header for downloading the video.',
  })
  @ApiResponse({
    status: 200,
    description: 'Pre-signed download URL',
    schema: {
      properties: {
        url: { type: 'string' },
        expires_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready for playback yet',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getDownloadUrl(
    @Param('slug') slug: string,
  ): Promise<PresignedUrlResult> {
    return this.videosService.getDownloadUrl(slug);
  }

  @Get(':slug')
  @Public()
  @ApiOperation({
    summary: 'Get video details',
    description:
      'Returns video metadata, including a pre-signed thumbnail URL when available.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video details',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        slug: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string' },
        channel_id: { type: 'string', format: 'uuid' },
        duration_seconds: { type: 'integer', nullable: true },
        thumbnail_url: { type: 'string', nullable: true },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findOne(@Param('slug') slug: string): Promise<VideoDetails> {
    return this.videosService.getVideoDetails(slug);
  }
}
