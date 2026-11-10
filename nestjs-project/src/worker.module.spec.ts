import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('should compile the standalone worker context with DB, storage and queue', async () => {
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(module).toBeDefined();
    await module.close();
  }, 15000);

  it('should declare no controllers (no HTTP surface)', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      WorkerModule,
    ) as unknown[] | undefined;

    expect(controllers ?? []).toHaveLength(0);
  });
});
