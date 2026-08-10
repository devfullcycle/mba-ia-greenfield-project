import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import queueConfig from '../config/queue.config';
import { PG_BOSS } from './queue.constants';
import { QueueModule } from './queue.module';
import { QueueService } from './queue.service';

describe('QueueModule', () => {
  it('compiles and exports both QueueService and the PG_BOSS provider', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
      ],
    }).compile();

    expect(moduleRef.get(QueueService)).toBeInstanceOf(QueueService);
    expect(moduleRef.get(PG_BOSS)).toBeDefined();
  });
});
