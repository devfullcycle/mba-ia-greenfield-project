import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import videoConfig from '../config/video.config';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { VideosDataModule } from '../videos/videos-data.module';
import { FfmpegService } from './ffmpeg.service';
import { VideoReconcilerService } from './video-reconciler.service';
import { VideoProcessor } from './video.processor';

/** Video processing pipeline; registered only in the worker process. */
@Module({
  imports: [
    VideosDataModule,
    StorageModule,
    QueueModule,
    ConfigModule.forFeature(videoConfig),
  ],
  providers: [FfmpegService, VideoProcessor, VideoReconcilerService],
})
export class ProcessingModule {}
