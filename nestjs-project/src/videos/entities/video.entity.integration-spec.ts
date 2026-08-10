import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { createTestDataSource } from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { Video } from './video.entity';
import { VideoStatus } from '../videos.constants';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

async function cleanTables(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM "videos"');
  await ds.query('DELETE FROM "channels"');
  await ds.query('DELETE FROM "users"');
}

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepo: Repository<User>;
  let channelRepo: Repository<Channel>;
  let videoRepo: Repository<Video>;
  let testChannel: Channel;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepo = dataSource.getRepository(User);
    channelRepo = dataSource.getRepository(Channel);
    videoRepo = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanTables(dataSource);
    const user = await userRepo.save(
      userRepo.create({
        email: `entity_test_${Date.now()}@test.com`,
        password: 'hash',
      }),
    );
    testChannel = await channelRepo.save(
      channelRepo.create({
        name: 'Test',
        nickname: `nick_${Date.now()}`,
        user_id: user.id,
      }),
    );
  });

  it('should insert a valid video record', async () => {
    const video = videoRepo.create({
      title: 'Test Video',
      status: VideoStatus.DRAFT,
      channel_id: testChannel.id,
      storage_key: 'videos/test/original.mp4',
    });
    const saved = await videoRepo.save(video);

    expect(saved.id).toBeDefined();
    expect(saved.status).toBe(VideoStatus.DRAFT);
    expect(saved.storage_key).toBe('videos/test/original.mp4');
  });

  it('should fail to insert without storage_key (NOT NULL constraint)', async () => {
    const video = videoRepo.create({
      title: 'No key',
      channel_id: testChannel.id,
    } as any);

    await expect(videoRepo.save(video)).rejects.toThrow();
  });

  it('should reject invalid status values', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO videos (title, status, channel_id, storage_key) VALUES ($1, $2, $3, $4)`,
        ['Bad', 'invalid_status', testChannel.id, 'key'],
      ),
    ).rejects.toThrow();
  });

  it('should fail to insert with invalid channel_id FK', async () => {
    const video = videoRepo.create({
      title: 'FK fail',
      status: VideoStatus.DRAFT,
      channel_id: '00000000-0000-0000-0000-000000000000',
      storage_key: 'videos/test/original.mp4',
    });

    await expect(videoRepo.save(video)).rejects.toThrow();
  });
});
