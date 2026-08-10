import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import appConfig from '../config/app.config';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';

describe('StorageModule', () => {
  it('should compile successfully', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [appConfig, storageConfig],
        }),
        StorageModule,
      ],
    }).compile();

    expect(module).toBeDefined();
    await module.close();
  }, 15000);
});
