import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Redirect,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { Public } from '../auth/decorators/public.decorator';
import { ChannelsService } from '../channels/channels.service';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { VideoStatus } from './entities/video.entity';
import { InitiateUploadResult, VideosService } from './videos.service';

interface VideoSummary {
  id: string;
  status: VideoStatus;
  original_filename: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  created_at: Date;
}

@SkipThrottle()
@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly channelsService: ChannelsService,
  ) {}

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initiate a video upload',
    description:
      'Pre-registers a video as a draft and returns presigned multipart upload URLs for the client to upload directly to storage.',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload initiated',
    schema: {
      properties: {
        id: { type: 'string' },
        upload_id: { type: 'string' },
        parts: {
          type: 'array',
          items: {
            properties: {
              part_number: { type: 'number' },
              url: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'File exceeds the 10GB limit, or validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ): Promise<InitiateUploadResult> {
    const channel = await this.channelsService.findByUserId(user.sub);
    return this.videosService.initiateUpload(channel.id, dto);
  }

  @Post(':publicId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Finalizes the multipart upload with storage and enqueues the video for processing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed — the video is now processing',
    schema: {
      properties: {
        id: { type: 'string' },
        status: { type: 'string', example: 'processando' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'The authenticated user does not own this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'The upload was already completed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<{ id: string; status: VideoStatus }> {
    const channel = await this.channelsService.findByUserId(user.sub);
    return this.videosService.completeUpload(channel.id, publicId, dto);
  }

  @Delete(':publicId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Abort a video upload',
    description:
      'Aborts an in-progress multipart upload and removes the draft video row.',
  })
  @ApiResponse({ status: 204, description: 'Upload aborted successfully' })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'The authenticated user does not own this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'The video is not in an abortable state',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<void> {
    const channel = await this.channelsService.findByUserId(user.sub);
    return this.videosService.abortUpload(channel.id, publicId);
  }

  @Public()
  @Get(':publicId')
  @ApiOperation({
    summary: 'Get a video status and metadata',
    description:
      "Returns the video's status and metadata. Visible to anyone once the video is ready; visible to its owner at any status.",
  })
  @ApiResponse({
    status: 200,
    description: 'Video status and metadata',
    schema: {
      properties: {
        id: { type: 'string' },
        status: { type: 'string' },
        original_filename: { type: 'string' },
        duration_seconds: { type: 'number', nullable: true },
        width: { type: 'number', nullable: true },
        height: { type: 'number', nullable: true },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not visible to the requester',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getVideo(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('publicId') publicId: string,
  ): Promise<VideoSummary> {
    const requesterChannelId = await this.resolveRequesterChannelId(user);
    const video = await this.videosService.findByPublicId(
      publicId,
      requesterChannelId,
    );
    return {
      id: video.public_id,
      status: video.status,
      original_filename: video.original_filename,
      duration_seconds: video.duration_seconds,
      width: video.width,
      height: video.height,
      created_at: video.created_at,
    };
  }

  @Public()
  @Get(':publicId/stream')
  @Redirect()
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Redirects to a short-lived presigned URL for the original file, which the storage layer serves with native Range/206 support.',
  })
  @ApiResponse({ status: 302, description: 'Redirect to storage' })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not visible to the requester',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready for playback',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async streamVideo(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('publicId') publicId: string,
  ): Promise<{ url: string; statusCode: number }> {
    const requesterChannelId = await this.resolveRequesterChannelId(user);
    const url = await this.videosService.getStreamUrl(
      publicId,
      requesterChannelId,
    );
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Public()
  @Get(':publicId/download')
  @Redirect()
  @ApiOperation({
    summary: 'Download a video',
    description:
      'Redirects to a short-lived presigned URL for the original file, with an attachment content-disposition.',
  })
  @ApiResponse({ status: 302, description: 'Redirect to storage' })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not visible to the requester',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready for playback',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async downloadVideo(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('publicId') publicId: string,
  ): Promise<{ url: string; statusCode: number }> {
    const requesterChannelId = await this.resolveRequesterChannelId(user);
    const url = await this.videosService.getDownloadUrl(
      publicId,
      requesterChannelId,
    );
    return { url, statusCode: HttpStatus.FOUND };
  }

  private async resolveRequesterChannelId(
    user: JwtPayload | undefined,
  ): Promise<string | undefined> {
    if (!user) return undefined;
    const channel = await this.channelsService.findByUserId(user.sub);
    return channel.id;
  }
}
