import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { PgBoss } from 'pg-boss';
import type { QueryRunner } from 'typeorm';
import queueConfig from '../config/queue.config';
import { PG_BOSS, QUEUE_NAMES } from './queue.constants';

export interface VideoProcessingPayload {
  videoId: string;
  bucket: string;
  key: string;
}

@Injectable()
export class QueueService implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    await this.boss.createQueue(QUEUE_NAMES.VIDEO_PROCESSING_DLQ);
    await this.boss.createQueue(QUEUE_NAMES.VIDEO_PROCESSING, {
      deadLetter: QUEUE_NAMES.VIDEO_PROCESSING_DLQ,
    });
    // createQueue() no-ops if the queue row already exists (e.g. from a
    // deployment predating this option), so updateQueue() is required to
    // guarantee the dead-letter wiring is actually applied.
    await this.boss.updateQueue(QUEUE_NAMES.VIDEO_PROCESSING, {
      deadLetter: QUEUE_NAMES.VIDEO_PROCESSING_DLQ,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop();
  }

  async enqueueVideoProcessing(
    payload: VideoProcessingPayload,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await this.boss.send(QUEUE_NAMES.VIDEO_PROCESSING, payload, {
      retryLimit: this.config.retryLimit,
      retryDelay: this.config.retryDelaySeconds,
      retryBackoff: true,
      db: {
        executeSql: async (sql: string, params?: unknown[]) => ({
          rows: (await queryRunner.query(sql, params)) as unknown[],
        }),
      },
    });
  }
}
