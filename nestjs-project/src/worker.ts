import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import storageConfig from './config/storage.config';
import { envValidationSchema } from './config/env.validation';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { Video } from './videos/entities/video.entity';
import { VideoProcessor } from './videos/worker/video-processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
      validationSchema: envValidationSchema,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([Video]),
    ConfigModule.forFeature(storageConfig),
    StorageModule,
    QueueModule,
  ],
  providers: [VideoProcessor],
})
class WorkerAppModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  console.log('Video Worker Application initialized and listening for jobs...');
}

bootstrap();
