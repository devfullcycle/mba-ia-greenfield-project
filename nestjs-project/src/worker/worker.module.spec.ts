import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { Video } from '../videos/entities/video.entity';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('should compile with the database, storage and queue providers', async () => {
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(module.get(StorageService)).toBeDefined();
    expect(module.get(QueueService)).toBeDefined();
    expect(module.get(DataSource).getRepository(Video)).toBeDefined();
    await module.close();
  }, 30000);
});
