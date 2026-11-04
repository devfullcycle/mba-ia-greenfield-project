import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueModule, videoProcessingQueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { Video } from '../videos/entities/video.entity';
import { FfmpegService } from './services/ffmpeg.service';
import { VideoProcessingProcessor } from './video-processing.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    StorageModule,
    QueueModule,
    videoProcessingQueueModule,
  ],
  providers: [FfmpegService, VideoProcessingProcessor],
  exports: [FfmpegService],
})
export class VideoWorkerModule {}
