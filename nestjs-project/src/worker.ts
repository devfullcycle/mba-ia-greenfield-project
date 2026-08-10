import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import databaseConfig from './config/database.config';
import storageConfig from './config/storage.config';
import queueConfig from './config/queue.config';
import { envValidationSchema } from './config/env.validation';
import { StorageModule } from './storage/storage.module';
import { VideoProcessingModule } from './video-processing/video-processing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, storageConfig, queueConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbCfg: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbCfg.host,
        port: dbCfg.port,
        username: dbCfg.username,
        password: dbCfg.password,
        database: dbCfg.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [queueConfig.KEY],
      useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
        connection: { host: cfg.host, port: cfg.port, password: cfg.password },
      }),
    }),
    StorageModule,
    VideoProcessingModule,
  ],
})
class WorkerAppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    logger: ['log', 'error', 'warn'],
  });
  app.enableShutdownHooks();
}

void bootstrap();
