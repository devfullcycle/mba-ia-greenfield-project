import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@ApiBearerAuth()
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Initiate a video upload (creates a draft + presigned part URLs)',
  })
  async initiate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ) {
    return this.videosService.initiateUpload(user.sub, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finalize the upload and start processing',
  })
  async complete(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.videosService.completeUpload(user.sub, id, dto);
  }

  @Public()
  @Get(':publicId')
  @ApiOperation({ summary: 'Read public video metadata and status' })
  async getOne(@Param('publicId') publicId: string) {
    return this.videosService.getByPublicId(publicId);
  }

  @Public()
  @Get(':publicId/stream')
  @ApiOperation({
    summary: 'Stream the video (HTTP Range / 206 Partial Content)',
  })
  async stream(
    @Param('publicId') publicId: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const obj = await this.videosService.streamByPublicId(publicId, range);
    res.status(range ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK);
    if (obj.contentRange) {
      res.setHeader('Content-Range', obj.contentRange);
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', obj.contentLength.toString());
    res.setHeader('Content-Type', obj.contentType);
    obj.stream.pipe(res);
  }

  @Public()
  @Get(':publicId/download')
  @ApiOperation({ summary: 'Download the full video (presigned redirect)' })
  async download(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.videosService.getDownloadUrl(publicId);
    res.redirect(HttpStatus.FOUND, url);
  }
}
