import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { Video } from './entities/video.entity';
import { VideosModule } from './videos.module';

const mockRepository = {};
const mockDataSource = {
  entityMetadatas: [],
  options: { type: 'postgres' },
  getRepository: jest.fn().mockReturnValue(mockRepository),
};

@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: mockDataSource }],
  exports: [getDataSourceToken()],
})
class MockDataSourceModule {}

describe('VideosModule', () => {
  it('compiles with TypeOrmModule.forFeature wiring for Video', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, queueConfig],
        }),
        MockDataSourceModule,
        VideosModule,
      ],
    }).compile();

    expect(moduleRef.get(getRepositoryToken(Video))).toBe(mockRepository);
  });
});
