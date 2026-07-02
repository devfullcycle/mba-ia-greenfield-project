import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Redirect,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalUser } from '../auth/decorators/optional-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { UploadPartUrlDto } from './dto/upload-part-url.dto';
import { VideoStatus } from './video.entity';
import { VideoReadResponse, VideosService } from './videos.service';

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
      'Pre-registers the video as a draft owned by the authenticated channel and starts a multipart upload session.',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload initiated',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: VideoStatus.DRAFT },
        uploadId: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed, unsupported media type, or file too large',
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
  ): Promise<{ id: string; status: VideoStatus; uploadId: string }> {
    const channel = await this.getOwnedChannelOrThrow(user.sub);
    return this.videosService.initiateUpload(channel.id, dto);
  }

  @Post(':id/upload-part-url')
  @HttpCode(200)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', description: 'Video id', format: 'uuid' })
  @ApiOperation({
    summary: 'Get a presigned upload URL for a multipart part',
    description:
      'Returns a presigned URL the client can PUT a single multipart upload part to. Restricted to the video owner.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned URL generated',
    schema: { properties: { url: { type: 'string' } } },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or invalid part number',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video does not exist or is not owned by the current user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async uploadPartUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UploadPartUrlDto,
  ): Promise<{ url: string }> {
    const channel = await this.getOwnedChannelOrThrow(user.sub);
    return this.videosService.getPartUploadUrl(id, channel.id, dto);
  }

  @Post(':id/complete-upload')
  @HttpCode(200)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', description: 'Video id', format: 'uuid' })
  @ApiOperation({
    summary: 'Complete a multipart video upload',
    description:
      'Finalizes the multipart upload, flips the video to uploaded, and enqueues processing. Restricted to the video owner.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: VideoStatus.UPLOADED },
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
    description: 'Video does not exist or is not owned by the current user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in draft status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<{ id: string; status: VideoStatus }> {
    const channel = await this.getOwnedChannelOrThrow(user.sub);
    return this.videosService.completeUpload(id, channel.id, dto);
  }

  @Get(':id')
  @Public()
  @ApiParam({ name: 'id', description: 'Video id', format: 'uuid' })
  @ApiOperation({
    summary: 'Get video metadata',
    description:
      'Returns video metadata. Anonymous and non-owner requests only see videos in "ready" status; the owner can read any status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video metadata',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        title: { type: 'string' },
        status: { type: 'string', example: VideoStatus.READY },
        durationSeconds: { type: 'number', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        thumbnailUrl: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'Video does not exist, or is not ready and the requester is not its owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getVideo(
    @OptionalUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<VideoReadResponse> {
    const video = await this.videosService.getVideoForRead(id, user?.sub);
    return this.videosService.buildVideoReadResponse(video);
  }

  @Get(':id/stream')
  @Public()
  @Redirect()
  @ApiParam({ name: 'id', description: 'Video id', format: 'uuid' })
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Redirects to a presigned storage URL that supports Range requests for playback. Same authorization rule as GET /videos/:id.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to a presigned read URL in storage',
  })
  @ApiResponse({
    status: 404,
    description:
      'Video does not exist, or is not ready and the requester is not its owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async streamVideo(
    @OptionalUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ url: string }> {
    const video = await this.videosService.getVideoForRead(id, user?.sub);
    const url = await this.videosService.getVideoReadUrl(video);
    return { url };
  }

  @Get(':id/download')
  @Public()
  @Redirect()
  @ApiParam({ name: 'id', description: 'Video id', format: 'uuid' })
  @ApiOperation({
    summary: 'Download a video',
    description:
      'Redirects to a presigned storage URL with a Content-Disposition: attachment header. Same authorization rule as GET /videos/:id.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to a presigned read URL in storage (attachment)',
  })
  @ApiResponse({
    status: 404,
    description:
      'Video does not exist, or is not ready and the requester is not its owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async downloadVideo(
    @OptionalUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ url: string }> {
    const video = await this.videosService.getVideoForRead(id, user?.sub);
    const url = await this.videosService.getVideoReadUrl(video, {
      attachment: true,
    });
    return { url };
  }

  private async getOwnedChannelOrThrow(userId: string): Promise<Channel> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new Error('Channel not found for authenticated user');
    }
    return channel;
  }
}
