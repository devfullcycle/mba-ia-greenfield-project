import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { VideoProcessingConsumer } from './worker/video-processing.consumer';
import { WorkerModule } from './worker/worker.module';

async function bootstrap() {
  const logger = new Logger('WorkerBootstrap');
  const app = await NestFactory.createApplicationContext(WorkerModule);

  const consumer = app.get(VideoProcessingConsumer);
  await consumer.register();

  logger.log('Video processing worker registered and running');
}
void bootstrap();
