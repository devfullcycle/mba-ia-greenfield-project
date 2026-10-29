import { Test } from '@nestjs/testing';
import { WorkerModule } from './worker.module';
import { MediaProbeService } from './media-probe.service';
import { VideoProcessor } from './video.processor';

describe('WorkerModule', () => {
  it('should compile with the processor, the FFmpeg wrapper and no HTTP controllers', async () => {
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(module.get(VideoProcessor)).toBeInstanceOf(VideoProcessor);
    expect(module.get(MediaProbeService)).toBeInstanceOf(MediaProbeService);
    await module.close();
  }, 30000);
});
