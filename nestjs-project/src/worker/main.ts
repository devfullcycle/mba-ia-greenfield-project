import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    WorkerModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL!],
        queue:
          process.env.RABBITMQ_VIDEO_PROCESSING_QUEUE || 'video_processing',
        queueOptions: { durable: true },
        noAck: false,
      },
    },
  );
  await app.listen();
}
void bootstrap();
