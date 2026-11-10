import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
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
}
