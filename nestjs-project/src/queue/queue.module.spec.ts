import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import { QueueModule } from './queue.module';
import { VIDEO_PROCESSING_QUEUE } from './queue.constants';

describe('QueueModule', () => {
  it('compiles and registers the video-processing queue', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
      ],
    }).compile();

    const queue = module.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
    expect(queue.name).toBe(VIDEO_PROCESSING_QUEUE);
    expect(queue.opts.defaultJobOptions?.attempts).toBe(3);

    await module.close();
  });
});
