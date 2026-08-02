import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import appConfig from '../../nestjs-project/src/config/app.config';
import databaseConfig from '../../nestjs-project/src/config/database.config';
import storageConfig from '../../nestjs-project/src/config/storage.config';
import queueConfig from '../../nestjs-project/src/config/queue.config';
import { envValidationSchema } from '../../nestjs-project/src/config/env.validation';
import { QueueModule } from '../../nestjs-project/src/queue/queue.module';
import { StorageModule } from '../../nestjs-project/src/storage/storage.module';
import { VideoProcessingModule } from './video-processing/video-processing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, storageConfig, queueConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
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
    QueueModule,
    StorageModule,
    VideoProcessingModule,
  ],
})
export class AppModule {}
