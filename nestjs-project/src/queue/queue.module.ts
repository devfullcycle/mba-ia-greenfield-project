import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PgBoss } from 'pg-boss';
import queueConfig from '../config/queue.config';
import { PG_BOSS } from './queue.constants';
import { QueueService } from './queue.service';

@Module({
  providers: [
    {
      provide: PG_BOSS,
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) =>
        new PgBoss(config.connectionString),
    },
    QueueService,
  ],
  exports: [QueueService, PG_BOSS],
})
export class QueueModule {}
