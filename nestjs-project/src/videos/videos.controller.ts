import { Controller, Get, Headers, Logger, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'stream/promises';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { attachmentDisposition } from './content-disposition';
import { VideoResponseDto } from './dto/video-response.dto';
import {
  MediaDeliveryService,
  type MediaResponse,
} from './media-delivery.service';
import { VideosService } from './videos.service';

// A <video> player fires many Range requests; the global throttler is for auth only.
@SkipThrottle()
@ApiTags('videos')
@Controller('videos')
export class VideosController {
  private readonly logger = new Logger(VideosController.name);

  constructor(
    private readonly videosService: VideosService,
    private readonly mediaDelivery: MediaDeliveryService,
  ) {}

  @OptionalAuth()
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get video metadata',
    description:
      'Public route with optional authentication: the owner sees any status, everyone else only READY videos. Media URLs are only set when READY.',
  })
  @ApiParam({ name: 'id', description: 'Video public id' })
  @ApiResponse({ status: 200, type: VideoResponseDto })
  @ApiResponse({
    status: 404,
    description:
      'Video not found, or not READY and the requester is not the owner (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload | undefined,
  ): Promise<VideoResponseDto> {
    const video = await this.videosService.findVisible(id, user?.sub ?? null);
    return VideoResponseDto.from(video);
  }

  @Public()
  @Get(':id/stream')
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Proxies the video file with Range pass-through (206 for partial content). READY videos only.',
  })
  @ApiParam({ name: 'id', description: 'Video public id' })
  @ApiProduces('video/*')
  @ApiResponse({ status: 200, description: 'Full video body' })
  @ApiResponse({ status: 206, description: 'Requested byte range' })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not READY (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 416,
    description:
      'Range outside the file size (RANGE_NOT_SATISFIABLE); Content-Range: bytes */{size}',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const video = await this.videosService.findReady(id);
    await this.send(res, await this.mediaDelivery.openMedia(video, range));
  }

  @Public()
  @Get(':id/download')
  @ApiOperation({
    summary: 'Download a video',
    description:
      'Same as stream, as an attachment named after the original file. Supports Range for resumable downloads. READY videos only.',
  })
  @ApiParam({ name: 'id', description: 'Video public id' })
  @ApiProduces('video/*')
  @ApiResponse({ status: 200, description: 'Full video body as attachment' })
  @ApiResponse({ status: 206, description: 'Requested byte range' })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not READY (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 416,
    description: 'Range outside the file size (RANGE_NOT_SATISFIABLE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const video = await this.videosService.findReady(id);
    const media = await this.mediaDelivery.openMedia(video, range);
    media.headers['Content-Disposition'] = attachmentDisposition(
      video.original_filename,
    );
    await this.send(res, media);
  }

  @Public()
  @Get(':id/thumbnail')
  @ApiOperation({
    summary: 'Get a video thumbnail',
    description: 'JPEG frame generated during processing. READY videos only.',
  })
  @ApiParam({ name: 'id', description: 'Video public id' })
  @ApiProduces('image/jpeg')
  @ApiResponse({ status: 200, description: 'JPEG thumbnail' })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not READY (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async thumbnail(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const video = await this.videosService.findReady(id);
    await this.send(res, await this.mediaDelivery.openThumbnail(video));
  }

  /**
   * Pipes with backpressure; if the client disconnects, pipeline destroys the
   * storage stream so the S3 socket is released.
   */
  private async send(res: Response, media: MediaResponse): Promise<void> {
    res.status(media.status).set(media.headers);
    try {
      await pipeline(media.body, res);
    } catch (err) {
      // Headers are already sent, so there is no error response left to give:
      // typically the client aborted mid-download.
      this.logger.warn(`Media delivery interrupted: ${String(err)}`);
    }
  }
}
