import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { VideosService } from './videos.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { ListVideosQueryDto } from './dto/list-videos-query.dto';

@ApiTags('videos')
@Controller()
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  // POST /videos — US1: Initiate upload
  @Post('videos')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initiate video upload',
    description:
      'Creates a draft video record and returns a pre-signed PUT URL for direct upload to storage.',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload initiated',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string' },
        upload_url: { type: 'string' },
        storage_key: { type: 'string' },
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
    description: 'Unauthorized',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'No channel found for user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initiateUpload(
    @Body() dto: InitiateUploadDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.videosService.initiateUpload(user.sub, dto);
  }

  // POST /videos/:id/upload-complete — US2: Confirm upload and enqueue processing
  @Post('videos/:id/upload-complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Confirm upload complete',
    description:
      'Marks the upload as complete and enqueues the video for processing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Processing enqueued',
    schema: {
      properties: { id: { type: 'string' }, status: { type: 'string' } },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Video is not in draft status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Not the video owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async confirmUpload(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.videosService.confirmUpload(id, user.sub);
  }

  // GET /videos/:id — US3: Public video details
  @Public()
  @Get('videos/:id')
  @ApiOperation({
    summary: 'Get video details',
    description: 'Returns public metadata for a video regardless of status.',
  })
  @ApiResponse({ status: 200, description: 'Video metadata' })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findById(@Param('id') id: string) {
    return this.videosService.findById(id);
  }

  // GET /videos/:id/stream — US3: Public streaming with range requests
  @Public()
  @Get('videos/:id/stream')
  @ApiOperation({
    summary: 'Stream video',
    description:
      'Streams the video file with range request support. Only available for ready videos.',
  })
  @ApiResponse({ status: 200, description: 'Full video stream' })
  @ApiResponse({ status: 206, description: 'Partial content (range request)' })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async streamVideo(
    @Param('id') id: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.videosService.streamVideo(id, rangeHeader);
    res.status(result.statusCode);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.contentLength);
    res.setHeader('Accept-Ranges', 'bytes');
    if (result.contentRange) {
      res.setHeader('Content-Range', result.contentRange);
    }
    result.stream.pipe(res);
  }

  // GET /videos/:id/download — US4: Authenticated download
  @Get('videos/:id/download')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Download video',
    description:
      'Downloads the full video file with Content-Disposition: attachment header. Requires authentication but not ownership.',
  })
  @ApiResponse({ status: 200, description: 'Video file download' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async downloadVideo(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.videosService.downloadVideo(id);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.contentLength);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.filename)}"`,
    );
    result.stream.pipe(res);
  }

  // GET /channels/:channelId/videos — US6: List channel videos (paginated, OWNER)
  @Get('channels/:channelId/videos')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List channel videos',
    description:
      'Returns paginated list of videos for a channel. Requires ownership.',
  })
  @ApiResponse({ status: 200, description: 'Paginated video list' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Not the channel owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Channel not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async listChannelVideos(
    @Param('channelId') channelId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: ListVideosQueryDto,
  ) {
    return this.videosService.listChannelVideos(channelId, user.sub, query);
  }

  // PATCH /videos/:id — US6: Update title
  @Patch('videos/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update video title',
    description: 'Updates the video title. The video ID remains unchanged.',
  })
  @ApiResponse({ status: 200, description: 'Video updated' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Not the video owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async updateTitle(
    @Param('id') id: string,
    @Body() dto: UpdateVideoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.videosService.updateTitle(id, user.sub, dto);
  }

  // DELETE /videos/:id — US6: Delete video
  @Delete('videos/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Delete video',
    description:
      'Deletes the video record, storage files, and cancels any pending processing job.',
  })
  @ApiResponse({ status: 204, description: 'Video deleted' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Not the video owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async deleteVideo(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.videosService.deleteVideo(id, user.sub);
  }
}
