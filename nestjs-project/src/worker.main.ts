import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // SIGTERM/SIGINT stop pg-boss gracefully, so no job is left stuck.
  app.enableShutdownHooks();
  new Logger('Worker').log('Video worker started');
}

void bootstrap();
