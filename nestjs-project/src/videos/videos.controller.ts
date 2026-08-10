import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ConfigType } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import { StorageService } from './services/storage.service';
import storageConfig from '../config/storage.config';
import { VideoStatus } from './entities/video.entity';

import { VideosService } from './videos.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { Public } from '../auth/decorators/public.decorator';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { GetPartUrlDto } from './dto/get-part-url.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadResponseDto } from './dto/initiate-upload-response.dto';
import { CompleteUploadResponseDto } from './dto/complete-upload-response.dto';
import { VideoDetailsResponseDto } from './dto/video-details-response.dto';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
  ) {}

  @Post('upload/initiate')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initiate video upload',
    description:
      'Creates a video record in DRAFT status and initializes a multipart upload on S3/MinIO.',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload initiated successfully',
    type: InitiateUploadResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'User does not have a channel to upload videos',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponseDto> {
    return this.videosService.initiateUpload(user.sub, dto);
  }

  @Post(':id/upload/part-url')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Generate presigned part upload URL',
    description:
      'Generates a temporary presigned URL for direct chunk upload to MinIO.',
  })
  @ApiResponse({
    status: 201,
    description: 'Presigned URL generated successfully',
    schema: {
      properties: {
        url: {
          type: 'string',
          example: 'https://minio/videos/...partNumber=1',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid status or missing parameters',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'User does not own the video record',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  generatePresignedPartUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: GetPartUrlDto,
  ): Promise<{ url: string }> {
    return this.videosService.generatePresignedPartUrl(user.sub, id, dto);
  }

  @Post(':id/upload/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete multipart upload',
    description:
      'Triggers the merge of all chunks on S3/MinIO and enqueues the video for transcoding.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed successfully, transcoding initiated',
    type: CompleteUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid upload parts or status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'User does not own the video record',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  completeUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CompleteUploadDto,
  ): Promise<CompleteUploadResponseDto> {
    return this.videosService.completeUpload(user.sub, id, dto);
  }

  @Public()
  @Get(':unique_url_id')
  @ApiOperation({
    summary: 'Get video details by unique URL identifier',
    description:
      'Returns metadata details of a published video. Public endpoint.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video details payload',
    type: VideoDetailsResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  getVideoDetails(
    @Param('unique_url_id') uniqueUrlId: string,
  ): Promise<VideoDetailsResponseDto> {
    return this.videosService.getVideoDetails(uniqueUrlId);
  }

  @Public()
  @Get(':unique_url_id/stream')
  @ApiOperation({
    summary: 'Stream video chunk (Range Requests)',
    description:
      'Serves partial video content (HTTP 206) for video players supporting range seeking. Public.',
  })
  @ApiResponse({
    status: 206,
    description: 'Partial video chunk stream',
  })
  @ApiResponse({
    status: 400,
    description: 'Video not ready or invalid range',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async streamVideo(
    @Param('unique_url_id') uniqueUrlId: string,
    @Headers('range') range: string,
    @Res() res: Response,
  ): Promise<void> {
    const video = await this.videosService.findVideoByUrlId(uniqueUrlId);
    if (!video) {
      throw new NotFoundException('Video not found');
    }
    if (video.status !== VideoStatus.READY) {
      throw new BadRequestException('Video is not ready for streaming');
    }
    if (!video.video_key) {
      throw new BadRequestException('Video file key is missing');
    }

    try {
      const { stream, contentLength, contentRange, acceptRanges, contentType } =
        await this.storageService.getObjectStream(
          this.storageCfg.bucketVideos,
          video.video_key,
          range,
        );

      res.status(range ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK);
      res.set({
        'Content-Type': contentType,
        'Content-Length': contentLength,
        'Accept-Ranges': acceptRanges,
        ...(contentRange && { 'Content-Range': contentRange }),
      });

      stream.pipe(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Streaming error: ${msg}`);
    }
  }

  @Public()
  @Get(':unique_url_id/download')
  @ApiOperation({
    summary: 'Download full video file',
    description:
      'Downloads the complete original video file as attachment. Public.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video file download',
  })
  @ApiResponse({
    status: 400,
    description: 'Video not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async downloadVideo(
    @Param('unique_url_id') uniqueUrlId: string,
    @Res() res: Response,
  ): Promise<void> {
    const video = await this.videosService.findVideoByUrlId(uniqueUrlId);
    if (!video) {
      throw new NotFoundException('Video not found');
    }
    if (video.status !== VideoStatus.READY) {
      throw new BadRequestException('Video is not ready for download');
    }
    if (!video.video_key) {
      throw new BadRequestException('Video file key is missing');
    }

    try {
      const { stream, contentLength } =
        await this.storageService.getObjectStream(
          this.storageCfg.bucketVideos,
          video.video_key,
        );

      res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${video.title}.mp4"`,
        'Content-Length': contentLength,
      });

      stream.pipe(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Download error: ${msg}`);
    }
  }
}
