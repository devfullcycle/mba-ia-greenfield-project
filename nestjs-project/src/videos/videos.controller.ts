import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { extname } from 'node:path';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import { VideosService } from './videos.service';

const videoUploadOptions = {
  storage: diskStorage({
    destination: tmpdir(),
    filename: (_request, file, callback) => {
      callback(null, `${randomUUID()}${extname(file.originalname)}`);
    },
  }),
};

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('upload')
  @ApiBearerAuth('access-token')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a video',
    description:
      'Streams the uploaded file to object storage and queues it for processing.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Video uploaded and queued for processing',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Missing file',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @UseInterceptors(FileInterceptor('file', videoUploadOptions))
  async upload(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<VideoResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const video = await this.videosService.uploadVideo(user.sub, file);
    return VideoResponseDto.fromEntity(video);
  }

  @Public()
  @Get(':id/stream')
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Streams a ready video, honoring HTTP Range requests (206 Partial Content).',
  })
  @ApiResponse({
    status: 200,
    description: 'Full video stream',
  })
  @ApiResponse({
    status: 206,
    description: 'Partial video stream',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const result = await this.videosService.streamVideo(id, range);

    response.status(result.status);
    for (const [name, value] of Object.entries(result.headers)) {
      response.setHeader(name, value);
    }

    return new StreamableFile(result.stream);
  }

  @Public()
  @Get(':id/download')
  @ApiOperation({
    summary: 'Download a video',
    description: 'Downloads a ready video as an attachment.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video file',
    headers: {
      'Content-Disposition': {
        description: 'Attachment filename',
        schema: { type: 'string' },
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
    description: 'Video is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const result = await this.videosService.downloadVideo(id);
    const filename = result.filename.replace(/["\r\n]/g, '_');

    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    response.setHeader('Content-Length', result.contentLength);

    return new StreamableFile(result.stream);
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get video status',
    description: 'Returns video metadata and processing status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video found',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findOne(@Param('id') id: string): Promise<VideoResponseDto> {
    const video = await this.videosService.findVideoById(id);
    return VideoResponseDto.fromEntity(video);
  }
}
