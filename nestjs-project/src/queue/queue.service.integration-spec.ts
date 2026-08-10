import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Job, PgBoss } from 'pg-boss';
import { DataSource } from 'typeorm';
import queueConfig from '../config/queue.config';
import { createTestDataSource } from '../test/create-test-data-source';
import { PG_BOSS, QUEUE_NAMES } from './queue.constants';
import { QueueModule } from './queue.module';
import { QueueService, type VideoProcessingPayload } from './queue.service';

describe('QueueService (integration)', () => {
  let queueService: QueueService;
  let boss: PgBoss;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource([]);
    await dataSource.initialize();

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
      ],
    }).compile();

    queueService = module.get(QueueService);
    boss = module.get(PG_BOSS);
    await queueService.onModuleInit();
  });

  afterAll(async () => {
    await queueService.onApplicationShutdown();
    await dataSource.destroy();
  });

  async function fetchJobFor(
    videoId: string,
  ): Promise<Job<VideoProcessingPayload> | undefined> {
    const jobs = await boss.fetch<VideoProcessingPayload>(
      QUEUE_NAMES.VIDEO_PROCESSING,
      { batchSize: 50 },
    );
    return jobs.find((job) => job.data.videoId === videoId);
  }

  it('leaves no fetchable job when the enclosing transaction is rolled back', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    const payload = {
      videoId: 'rollback-video',
      bucket: 'bucket',
      key: 'key',
    };

    try {
      await queueService.enqueueVideoProcessing(payload, queryRunner);
      await queryRunner.rollbackTransaction();
    } finally {
      await queryRunner.release();
    }

    const job = await fetchJobFor(payload.videoId);
    expect(job).toBeUndefined();
  });

  it('results in a fetchable job with the given payload when the enclosing transaction commits', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    const payload = { videoId: 'commit-video', bucket: 'bucket', key: 'key' };

    try {
      await queueService.enqueueVideoProcessing(payload, queryRunner);
      await queryRunner.commitTransaction();
    } finally {
      await queryRunner.release();
    }

    const job = await fetchJobFor(payload.videoId);
    expect(job?.data).toEqual(payload);
  });
});
