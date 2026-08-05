import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  Body,
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
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { InitUploadDto } from './dto/init-upload.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('upload-init')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initialize a video upload',
    description:
      "Creates a draft video linked to the caller's channel and returns a presigned URL for direct upload to storage.",
  })
  @ApiResponse({
    status: 201,
    description: 'Draft video created and presigned upload URL generated',
    schema: {
      properties: {
        videoId: { type: 'string', format: 'uuid' },
        urlCode: { type: 'string', example: 'v7K9mX2pL4qW' },
        uploadUrl: { type: 'string', format: 'uri' },
        storageKey: { type: 'string' },
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
    description: 'Authenticated user has no channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async uploadInit(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitUploadDto,
  ) {
    return this.videosService.uploadInit(user.sub, dto);
  }

  @Post(':urlCode/upload-complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Confirms the raw file exists in storage, transitions the video to processing, and enqueues the transcoding job.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video transitioned to processing',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        urlCode: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string', example: 'processing' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Video is not a draft, or file not found in storage',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: "Caller's channel does not own this video",
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found for the given urlCode',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async uploadComplete(
    @CurrentUser() user: JwtPayload,
    @Param('urlCode') urlCode: string,
  ) {
    return this.videosService.uploadComplete(user.sub, urlCode);
  }

  @Public()
  @Get(':urlCode')
  @ApiOperation({
    summary: 'Get video metadata',
    description: 'Returns public video metadata for the given urlCode.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video metadata',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        urlCode: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string', nullable: true },
        status: { type: 'string' },
        durationSeconds: { type: 'number', nullable: true },
        thumbnailUrl: { type: 'string', nullable: true },
        resolutionWidth: { type: 'number', nullable: true },
        resolutionHeight: { type: 'number', nullable: true },
        codec: { type: 'string', nullable: true },
        channel: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            nickname: { type: 'string' },
          },
        },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found for the given urlCode',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getByUrlCode(@Param('urlCode') urlCode: string) {
    return this.videosService.getByUrlCode(urlCode);
  }

  @Public()
  @Get(':urlCode/stream')
  @ApiOperation({
    summary: 'Stream video bytes',
    description:
      'Streams the raw video from storage, honoring the HTTP Range header for partial content playback.',
  })
  @ApiResponse({
    status: 206,
    description: 'Partial content stream (Range request satisfied)',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found for the given urlCode',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 400,
    description: 'Video is not ready or processing to be streamed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @Param('urlCode') urlCode: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, status, headers } = await this.videosService.stream(
      urlCode,
      range,
    );
    res.status(status);
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
    stream.pipe(res);
  }

  @Public()
  @Get(':urlCode/download')
  @ApiOperation({
    summary: 'Download the video file',
    description:
      'Redirects to a presigned storage URL for downloading the video as an attachment.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to the presigned download URL',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found for the given urlCode',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 400,
    description: 'Video is not ready or processing to be downloaded',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @Param('urlCode') urlCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.videosService.download(urlCode);
    res.redirect(HttpStatus.FOUND, url);
  }
}
