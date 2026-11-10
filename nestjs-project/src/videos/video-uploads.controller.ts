import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { InitiateUploadResponseDto } from './dto/initiate-upload-response.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { RenewPartsResponseDto } from './dto/renew-parts-response.dto';
import { RenewPartsDto } from './dto/renew-parts.dto';
import { VideoUploadsService } from './video-uploads.service';

// The global ThrottlerGuard (10 req/min) is meant for auth routes only.
@SkipThrottle()
@ApiTags('videos')
@ApiBearerAuth()
@Controller('videos')
export class VideoUploadsController {
  constructor(private readonly videoUploadsService: VideoUploadsService) {}

  @Post('uploads')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      'Starts a presigned multipart upload and pre-registers the video as DRAFT. Returns one presigned PUT URL per part (valid for 6h); no video bytes pass through the API.',
  })
  @ApiBody({ type: InitiateUploadDto })
  @ApiResponse({
    status: 201,
    description: 'Upload started; video pre-registered as DRAFT',
    type: InitiateUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed (non-video MIME type, size above 10GB, missing filename)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initiate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponseDto> {
    return this.videoUploadsService.initiate(user.sub, dto);
  }

  @Post(':id/uploads/parts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renew upload part URLs',
    description:
      'Re-signs presigned PUT URLs for parts of a DRAFT upload (resumed upload or expired URLs). Owner only.',
  })
  @ApiParam({ name: 'id', description: 'Video public id' })
  @ApiBody({ type: RenewPartsDto })
  @ApiResponse({
    status: 200,
    description: 'Fresh part URLs, valid for 6h',
    type: RenewPartsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, or a part_number exceeds the part count (INVALID_UPLOAD_PARTS)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another user (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in DRAFT status (VIDEO_NOT_IN_DRAFT)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async renewParts(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RenewPartsDto,
  ): Promise<RenewPartsResponseDto> {
    return this.videoUploadsService.renewParts(id, user.sub, dto);
  }

  @Delete(':id/uploads')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Abort a video upload',
    description:
      'Aborts the multipart upload in storage and removes the DRAFT video. Owner only.',
  })
  @ApiParam({ name: 'id', description: 'Video public id' })
  @ApiResponse({ status: 204, description: 'Upload aborted, draft removed' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another user (VIDEO_NOT_FOUND)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in DRAFT status (VIDEO_NOT_IN_DRAFT)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async abort(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.videoUploadsService.abort(id, user.sub);
  }
}
