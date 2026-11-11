import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import databaseConfig from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { ProcessingModule } from './processing/processing.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

/** Root module of the standalone video-worker process: no controllers, guards or HTTP providers. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    DatabaseModule,
    // Registers User and Channel: autoLoadEntities only knows entities passed to
    // forFeature, and Video's relation graph (Video -> Channel -> User) needs them.
    UsersModule,
    StorageModule,
    QueueModule,
    ScheduleModule.forRoot(),
    ProcessingModule,
  ],
})
export class WorkerModule {}
