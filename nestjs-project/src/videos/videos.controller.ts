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
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { SignPartsDto } from './dto/sign-parts.dto';
import { StartUploadDto } from './dto/start-upload.dto';
import {
  PlaybackUrlResponseDto,
  VideoResponseDto,
} from './dto/video-response.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      'Registers the video as a draft owned by the authenticated channel and opens a multipart upload in the storage.',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload started',
    schema: {
      properties: {
        public_id: { type: 'string', example: 'V1StGXR8_Z5' },
        upload_id: { type: 'string' },
        part_size_bytes: { type: 'integer' },
        status: { type: 'string', example: 'uploading' },
        visibility: { type: 'string', example: 'draft' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or file too large (FILE_TOO_LARGE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 415,
    description: 'Unsupported video format (UNSUPPORTED_VIDEO_FORMAT)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  startUpload(@CurrentUser() user: JwtPayload, @Body() dto: StartUploadDto) {
    return this.videosService.startUpload(user, dto);
  }

  @Post(':publicId/upload/part-urls')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign upload part URLs',
    description:
      'Returns presigned URLs so the client can upload the requested parts directly to the storage. Only the video owner can call it while the upload is open.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned part URLs',
    schema: {
      properties: {
        urls: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              part_number: { type: 'integer' },
              url: { type: 'string', format: 'uri' },
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
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Not the video owner (VIDEO_FORBIDDEN)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Upload already completed (UPLOAD_ALREADY_COMPLETED)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async signParts(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: SignPartsDto,
  ) {
    const urls = await this.videosService.signParts(
      user,
      publicId,
      dto.part_numbers,
    );
    return { urls };
  }

  @Post(':publicId/upload/complete')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Completes the multipart upload with the uploaded parts and queues the video for processing. Only the video owner can call it.',
  })
  @ApiResponse({
    status: 202,
    description: 'Upload completed, processing queued',
    schema: {
      properties: {
        public_id: { type: 'string', example: 'V1StGXR8_Z5' },
        status: { type: 'string', example: 'processing' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed or parts refused by the storage (UPLOAD_INCOMPLETE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Not the video owner (VIDEO_FORBIDDEN)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Upload already completed (UPLOAD_ALREADY_COMPLETED)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.videosService.completeUpload(user, publicId, dto);
  }

  @OptionalAuth()
  @Get(':publicId')
  @ApiOperation({
    summary: 'Get video status and metadata',
    description:
      'Returns the processing status and metadata, used for polling. Drafts are visible only to their owner (send the access token); anyone else gets 404.',
  })
  @ApiResponse({ status: 200, type: VideoResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not visible (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  getVideo(
    @CurrentUser() viewer: JwtPayload | undefined,
    @Param('publicId') publicId: string,
  ) {
    return this.videosService.getVideo(publicId, viewer);
  }

  @OptionalAuth()
  @Get(':publicId/stream')
  @ApiOperation({
    summary: 'Get the streaming URL',
    description:
      'Returns a presigned GET URL that supports HTTP Range requests, so the player streams without downloading the whole file. Drafts are visible only to their owner.',
  })
  @ApiResponse({ status: 200, type: PlaybackUrlResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not visible (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Processing not finished (VIDEO_NOT_READY)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  getStreamUrl(
    @CurrentUser() viewer: JwtPayload | undefined,
    @Param('publicId') publicId: string,
  ) {
    return this.videosService.getPlaybackUrl(publicId, viewer, {
      download: false,
    });
  }

  @OptionalAuth()
  @Get(':publicId/download')
  @ApiOperation({
    summary: 'Get the download URL',
    description:
      'Returns a presigned GET URL that serves the file as an attachment. Drafts are visible only to their owner.',
  })
  @ApiResponse({ status: 200, type: PlaybackUrlResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not visible (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Processing not finished (VIDEO_NOT_READY)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  getDownloadUrl(
    @CurrentUser() viewer: JwtPayload | undefined,
    @Param('publicId') publicId: string,
  ) {
    return this.videosService.getPlaybackUrl(publicId, viewer, {
      download: true,
    });
  }
}
