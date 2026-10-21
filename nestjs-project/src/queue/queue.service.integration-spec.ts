import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import databaseConfig from '../config/database.config';
import { createTestDataSource } from '../test/create-test-data-source';
import { QueueModule } from './queue.module';
import { QueueService } from './queue.service';

const waitFor = async (condition: () => boolean, timeoutMs = 10000) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('QueueService (integration)', () => {
  let module: TestingModule;
  let queue: QueueService;
  let dataSource: DataSource;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
        QueueModule,
      ],
    }).compile();
    await module.init();
    queue = module.get(QueueService);
    dataSource = createTestDataSource([], { synchronize: false });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
    await module.close();
  });

  it('should create the pg-boss schema on start without a manual migration', async () => {
    const [{ exists }] = await dataSource.query<{ exists: boolean }[]>(
      `SELECT to_regclass('pgboss.job') IS NOT NULL AS exists`,
    );
    expect(exists).toBe(true);
  });

  it('should deliver a job enqueued in a committed transaction to the handler with its payload', async () => {
    const name = `test.commit.${randomUUID()}`;
    const received: object[] = [];
    await queue.work(name, (job) => void received.push(job.data), {
      pollingIntervalSeconds: 0.5,
    });
    const payload = { videoId: randomUUID() };

    await dataSource.transaction((manager) =>
      queue.enqueue(name, payload, { transaction: manager }),
    );

    await waitFor(() => received.length > 0);
    expect(received).toEqual([payload]);
  });

  it('should not deliver a job enqueued in a rolled back transaction', async () => {
    const name = `test.rollback.${randomUUID()}`;
    const received: object[] = [];
    await queue.work(name, (job) => void received.push(job.data), {
      pollingIntervalSeconds: 0.5,
    });

    await expect(
      dataSource.transaction(async (manager) => {
        await queue.enqueue(
          name,
          { videoId: randomUUID() },
          { transaction: manager },
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    await sleep(2500);
    expect(received).toEqual([]);
  });

  it('should give the handler the retry counters of the job', async () => {
    const name = `test.retry.${randomUUID()}`;
    const received: { retryCount: number; retryLimit: number }[] = [];
    await queue.work(name, (job) => void received.push(job), {
      pollingIntervalSeconds: 0.5,
    });

    await queue.enqueue(name, { videoId: randomUUID() });
    await waitFor(() => received.length === 1);

    expect(received[0].retryCount).toBe(0);
    expect(received[0].retryLimit).toEqual(expect.any(Number));
  });
});
