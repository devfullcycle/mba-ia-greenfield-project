import {
  Body,
  Controller,
  HttpCode,
  Get,
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
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CompleteUploadResponseDto } from './dto/complete-upload-response.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitUploadResponseDto } from './dto/init-upload-response.dto';
import { InitUploadDto } from './dto/init-upload.dto';
import { SignPartsResponseDto } from './dto/sign-parts-response.dto';
import { SignPartsDto } from './dto/sign-parts.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      'Validates the declared file metadata, creates the video as a draft and opens a multipart upload. The client then asks for presigned part URLs and uploads the bytes directly to object storage.',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload started',
    type: InitUploadResponseDto,
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
    status: 413,
    description: 'Declared size exceeds the 10GB limit',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 415,
    description: 'Video type or extension is not allowed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitUploadDto,
  ): Promise<InitUploadResponseDto> {
    return this.videosService.initUpload(user.sub, dto);
  }

  @Post(':id/parts')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Sign upload part URLs',
    description:
      'Returns presigned PUT URLs for the requested part numbers of an upload in progress. Only the video owner can call it.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned part URLs',
    type: SignPartsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or part number out of range',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'The authenticated user does not own the video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not accepting uploads',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async signParts(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SignPartsDto,
  ): Promise<SignPartsResponseDto> {
    return this.videosService.signParts(user.sub, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Completes the multipart upload, verifies the stored object size, moves the video to PROCESSING and publishes the processing job. Idempotent: repeating the call never creates a second job.',
  })
  @ApiResponse({
    status: 202,
    description: 'Upload completed; processing queued',
    type: CompleteUploadResponseDto,
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
    description: 'The authenticated user does not own the video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description:
      'Stored object is missing, incomplete or differs from the declared size',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<CompleteUploadResponseDto> {
    return this.videosService.completeUpload(user.sub, id, dto);
  }

  @Public()
  @Get(':id/stream')
  @Redirect()
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Redirects to a short-lived presigned URL of the video file so the player streams straight from object storage (range requests supported). Public for videos that are READY.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to the presigned video URL',
    headers: {
      Location: {
        description: 'Presigned GET URL',
        schema: { type: 'string', format: 'uri' },
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
    description: 'Video is not ready yet',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @Param('id') id: string,
  ): Promise<{ url: string; statusCode: number }> {
    return {
      url: await this.videosService.getStreamUrl(id),
      statusCode: HttpStatus.FOUND,
    };
  }

  @Public()
  @Get(':id/download')
  @Redirect()
  @ApiOperation({
    summary: 'Download a video',
    description:
      'Redirects to a short-lived presigned URL that forces a download using the original file name. Public for videos that are READY.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to the presigned download URL',
    headers: {
      Location: {
        description:
          'Presigned GET URL carrying a response-content-disposition: attachment override',
        schema: { type: 'string', format: 'uri' },
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
    description: 'Video is not ready yet',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @Param('id') id: string,
  ): Promise<{ url: string; statusCode: number }> {
    return {
      url: await this.videosService.getDownloadUrl(id),
      statusCode: HttpStatus.FOUND,
    };
  }
}
