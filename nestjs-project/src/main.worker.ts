import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Entrypoint of the video-worker container. Creates a Nest application context
 * (no HTTP server): the BullMQ Worker inside VideoProcessor keeps the process
 * alive via its Redis connection.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  new Logger('VideoWorker').log('Video worker started — consuming queue');
}

void bootstrap();
