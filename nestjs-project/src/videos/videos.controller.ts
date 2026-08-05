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
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { InitUploadDto } from './dto/init-upload.dto';
import { VideosService } from './videos.service';

@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('upload-init')
  async uploadInit(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitUploadDto,
  ) {
    return this.videosService.uploadInit(user.sub, dto);
  }

  @Post(':urlCode/upload-complete')
  @HttpCode(HttpStatus.OK)
  async uploadComplete(
    @CurrentUser() user: JwtPayload,
    @Param('urlCode') urlCode: string,
  ) {
    return this.videosService.uploadComplete(user.sub, urlCode);
  }

  @Public()
  @Get(':urlCode')
  async getByUrlCode(@Param('urlCode') urlCode: string) {
    return this.videosService.getByUrlCode(urlCode);
  }

  @Public()
  @Get(':urlCode/stream')
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
  async download(
    @Param('urlCode') urlCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.videosService.download(urlCode);
    res.redirect(HttpStatus.FOUND, url);
  }
}
