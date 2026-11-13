import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { PresignedPartsDto } from './dto/presigned-parts.dto';
import { StartUploadDto } from './dto/start-upload.dto';
import { VideosService } from './videos.service';

@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Get(':id/stream')
  @Public()
  async stream(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.videosService.getStream(id, req.headers.range);
    res.status(result.statusCode);
    Object.entries(result.headers).forEach(([key, value]) =>
      res.setHeader(key, value),
    );
    result.stream.pipe(res);
  }

  @Get(':id/download')
  @Public()
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.videosService.getDownload(id);
    res.status(result.statusCode);
    Object.entries(result.headers).forEach(([key, value]) =>
      res.setHeader(key, value),
    );
    result.stream.pipe(res);
  }
  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateVideoDto) {
    return this.videosService.createVideo(user.sub, dto);
  }

  @Post(':id/upload')
  @HttpCode(HttpStatus.OK)
  async startUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: StartUploadDto,
  ) {
    return this.videosService.startUpload(user.sub, id, dto);
  }

  @Post(':id/upload/parts')
  @HttpCode(HttpStatus.OK)
  async presignedParts(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PresignedPartsDto,
  ) {
    return this.videosService.getPresignedParts(user.sub, id, dto);
  }

  @Post(':id/upload/complete')
  @HttpCode(HttpStatus.OK)
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.videosService.completeUpload(user.sub, id, dto);
  }

  @Post(':id/upload/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.videosService.cancelUpload(user.sub, id);
  }
}
