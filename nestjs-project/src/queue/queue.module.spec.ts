import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import databaseConfig from '../config/database.config';
import { QueueModule } from './queue.module';
import { QueueService } from './queue.service';

describe('QueueModule', () => {
  it('should compile successfully and expose QueueService', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
        QueueModule,
      ],
    }).compile();

    expect(module.get(QueueService)).toBeInstanceOf(QueueService);
    // Not initialised (no module.init()), so there is no pg-boss connection to close.
  });
});
