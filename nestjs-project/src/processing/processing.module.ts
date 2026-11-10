import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { VideosDataModule } from '../videos/videos-data.module';
import { FfmpegService } from './ffmpeg.service';
import { VideoProcessor } from './video.processor';

/** Video processing pipeline; registered only in the worker process. */
@Module({
  imports: [VideosDataModule, StorageModule, QueueModule],
  providers: [FfmpegService, VideoProcessor],
})
export class ProcessingModule {}
