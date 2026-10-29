import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import queueConfig from '../config/queue.config';
import { QueueModule } from './queue.module';
import { VideoProcessingProducer } from './video-processing.producer';

describe('QueueModule', () => {
  it('should compile successfully and provide VideoProcessingProducer', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
      ],
    }).compile();

    expect(module.get(VideoProcessingProducer)).toBeInstanceOf(
      VideoProcessingProducer,
    );
    await module.close();
  }, 15000);
});
