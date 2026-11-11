import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageModule', () => {
  it('should compile and expose StorageService with the test storage config', async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), StorageModule],
    }).compile();

    expect(module.get(StorageService)).toBeInstanceOf(StorageService);
    await module.close();
  });
});
