import { QueueService } from './queue.service';

describe('QueueService', () => {
  let service: QueueService;
  let send: jest.Mock;
  let start: jest.Mock;
  let stop: jest.Mock;
  let createQueue: jest.Mock;
  let updateQueue: jest.Mock;
  const config = {
    connectionString: 'postgres://user:pass@db:5432/db',
    retryLimit: 3,
    retryDelaySeconds: 30,
  };

  beforeEach(() => {
    send = jest.fn().mockResolvedValue('job-1');
    start = jest.fn().mockResolvedValue(undefined);
    stop = jest.fn().mockResolvedValue(undefined);
    createQueue = jest.fn().mockResolvedValue(undefined);
    updateQueue = jest.fn().mockResolvedValue(undefined);
    service = new QueueService(
      { send, start, stop, createQueue, updateQueue } as any,
      config,
    );
  });

  it('starts pg-boss and creates the video-processing queue with a dead-letter queue on module init', async () => {
    await service.onModuleInit();

    expect(start).toHaveBeenCalled();
    expect(createQueue).toHaveBeenCalledWith('video-processing-dlq');
    expect(createQueue).toHaveBeenCalledWith('video-processing', {
      deadLetter: 'video-processing-dlq',
    });
  });

  it('also calls updateQueue so the dead-letter wiring applies even if the queue row already existed', async () => {
    await service.onModuleInit();

    expect(updateQueue).toHaveBeenCalledWith('video-processing', {
      deadLetter: 'video-processing-dlq',
    });
  });

  it('stops pg-boss on application shutdown', async () => {
    await service.onApplicationShutdown();

    expect(stop).toHaveBeenCalled();
  });

  describe('enqueueVideoProcessing', () => {
    it('sends the job with the queue name, payload, retry options, and a db.executeSql delegating to the QueryRunner', async () => {
      const query = jest.fn().mockResolvedValue([]);
      const payload = { videoId: 'vid-1', bucket: 'bucket', key: 'key' };
      let capturedExecuteSql:
        | ((sql: string, params?: unknown[]) => Promise<unknown>)
        | undefined;
      send.mockImplementation(
        (
          _name: string,
          _data: unknown,
          options: { db: { executeSql: typeof capturedExecuteSql } },
        ) => {
          capturedExecuteSql = options.db.executeSql;
          return Promise.resolve('job-1');
        },
      );

      await service.enqueueVideoProcessing(payload, { query } as any);

      expect(send).toHaveBeenCalledWith(
        'video-processing',
        payload,
        expect.objectContaining({
          retryLimit: 3,
          retryDelay: 30,
          retryBackoff: true,
        }),
      );

      expect(capturedExecuteSql).toBeDefined();
      const result = await capturedExecuteSql!('SELECT 1', [1]);
      expect(query).toHaveBeenCalledWith('SELECT 1', [1]);
      expect(result).toEqual({ rows: [] });
    });
  });
});
