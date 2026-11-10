import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import { VideosService } from './videos.service';

// A <video> player fires many Range requests; the global throttler is for auth only.
@SkipThrottle()
@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

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
}
