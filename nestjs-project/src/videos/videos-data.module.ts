import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import videoConfig from '../config/video.config';
import { Video } from './entities/video.entity';
import { VideoPublicIdService } from './video-public-id.service';
import { VideosRepository } from './videos.repository';

/** Video persistence without HTTP providers — shared by the API and the worker. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ConfigModule.forFeature(videoConfig),
  ],
  providers: [VideosRepository, VideoPublicIdService],
  exports: [VideosRepository, VideoPublicIdService],
})
export class VideosDataModule {}
