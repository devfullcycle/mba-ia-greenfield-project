import { execFile } from 'child_process';
import { promisify } from 'util';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import databaseConfig from '../config/database.config';
import { envValidationSchema } from '../config/env.validation';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { MediaProbeService } from './media-probe.service';
import { StaleUploadScheduler } from './stale-upload.scheduler';
import { StaleUploadSweeper } from './stale-upload.sweeper';
import { VideoProcessor } from './video.processor';
import { EXEC_FILE } from './worker.constants';

/**
 * Root module of the standalone video worker: no HTTP controllers, only the
 * queue consumer and what it needs (database, storage, FFmpeg wrappers).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, queueConfig, storageConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
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
    // Video relates to Channel, which relates to User: all must be registered.
    TypeOrmModule.forFeature([
      User,
      Channel,
      RefreshToken,
      VerificationToken,
      Video,
    ]),
    QueueModule,
    StorageModule,
  ],
  providers: [
    { provide: EXEC_FILE, useValue: promisify(execFile) },
    MediaProbeService,
    StaleUploadSweeper,
    StaleUploadScheduler,
    VideoProcessor,
  ],
})
export class WorkerModule {}
