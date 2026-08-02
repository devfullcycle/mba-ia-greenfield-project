import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import {
  VideosService,
  InitiateUploadResult,
  VideoPlaybackResult,
} from './videos.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';

@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InitiateUploadResult> {
    const result = await this.videosService.initiateUpload(user.sub, dto);
    response.setHeader('Location', `/videos/${result.id}`);
    return result;
  }

  @Post(':id/complete-upload')
  @HttpCode(HttpStatus.OK)
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<{ id: string; status: string }> {
    return this.videosService.completeUpload(id, user.sub, dto);
  }

  @Public()
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<VideoPlaybackResult> {
    return this.videosService.findForPlayback(id);
  }
}
