import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import PgBoss from 'pg-boss';
import type { EntityManager } from 'typeorm';
import databaseConfig from '../config/database.config';
import { QUEUE_OPTIONS, type QueueName } from './queue.constants';

export interface EnqueueOptions {
  /** Writes the job in the caller's TypeORM transaction. */
  transaction?: EntityManager;
}

export interface JobContext<T extends object> {
  id: string;
  data: T;
  /** Retries already consumed; equals `retryLimit` on the last attempt. */
  retryCount: number;
  retryLimit: number;
}

export type JobHandler<T extends object> = (
  job: JobContext<T>,
) => Promise<void> | void;

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly boss: PgBoss;
  private readonly queues = new Set<string>();

  constructor(
    @Inject(databaseConfig.KEY)
    db: ConfigType<typeof databaseConfig>,
  ) {
    this.boss = new PgBoss({
      host: db.host,
      port: db.port,
      user: db.username,
      password: db.password,
      database: db.name,
    });
    this.boss.on('error', (error) =>
      this.logger.error(`pg-boss error: ${error.message}`, error.stack),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss.stop({ graceful: true, wait: true });
  }

  async enqueue<T extends object>(
    name: string,
    payload: T,
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    await this.ensureQueue(name);
    const { transaction } = options;
    return this.boss.send(
      name,
      payload,
      transaction
        ? {
            db: {
              executeSql: async (text: string, values: any[]) => ({
                rows: await transaction.query(text, values),
              }),
            },
          }
        : {},
    );
  }

  async work<T extends object>(
    name: string,
    handler: JobHandler<T>,
    options: { pollingIntervalSeconds?: number } = {},
  ): Promise<void> {
    await this.ensureQueue(name);
    await this.boss.work<T>(
      name,
      { ...options, includeMetadata: true },
      async (jobs) => {
        for (const job of jobs) {
          await handler({
            id: job.id,
            data: job.data,
            retryCount: job.retryCount,
            retryLimit: job.retryLimit,
          });
        }
      },
    );
  }

  async schedule(name: string, cron: string): Promise<void> {
    await this.ensureQueue(name);
    await this.boss.schedule(name, cron);
  }

  private async ensureQueue(name: string): Promise<void> {
    if (this.queues.has(name)) return;
    await this.boss.createQueue(name, {
      name,
      ...QUEUE_OPTIONS[name as QueueName],
    });
    this.queues.add(name);
  }
}
