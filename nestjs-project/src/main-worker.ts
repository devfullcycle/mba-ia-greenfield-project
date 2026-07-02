import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './videos/worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('VideoWorker');
  logger.log('Video worker started');

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}
void bootstrap();
