import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { Video } from './video.entity';
import { VideoStatus } from '../videos.constants';

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let channels: Repository<Channel>;
  let users: Repository<User>;
  let channelId: string;

  beforeAll(async () => {
    dataSource = createTestDataSource([User, Channel, Video]);
    await dataSource.initialize();
    videos = dataSource.getRepository(Video);
    channels = dataSource.getRepository(Channel);
    users = dataSource.getRepository(User);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);

    const user = await users.save(
      users.create({ email: `u-${Date.now()}@example.com`, password: 'x' }),
    );
    const channel = await channels.save(
      channels.create({
        name: 'ch',
        nickname: `nick-${Date.now()}`,
        user_id: user.id,
      }),
    );
    channelId = channel.id;
  });

  it('defaults status to draft and auto-populates timestamps', async () => {
    const saved = await videos.save(
      videos.create({
        public_id: 'pub-default',
        channel_id: channelId,
        title: 'My video',
      }),
    );

    expect(saved.status).toBe(VideoStatus.DRAFT);
    expect(saved.created_at).toBeInstanceOf(Date);
    expect(saved.updated_at).toBeInstanceOf(Date);
    expect(saved.storage_key).toBeNull();
    expect(saved.thumbnail_key).toBeNull();
    expect(saved.duration_seconds).toBeNull();
  });

  it('enforces a unique public_id', async () => {
    await videos.save(
      videos.create({
        public_id: 'dup',
        channel_id: channelId,
        title: 'first',
      }),
    );

    await expect(
      videos.save(
        videos.create({
          public_id: 'dup',
          channel_id: channelId,
          title: 'second',
        }),
      ),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('rejects a video with a non-existent channel (FK constraint)', async () => {
    await expect(
      videos.save(
        videos.create({
          public_id: 'orphan',
          channel_id: '00000000-0000-0000-0000-000000000000',
          title: 'orphan',
        }),
      ),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('loads the owning channel relation', async () => {
    await videos.save(
      videos.create({
        public_id: 'with-rel',
        channel_id: channelId,
        title: 'rel',
      }),
    );

    const found = await videos.findOne({
      where: { public_id: 'with-rel' },
      relations: { channel: true },
    });

    expect(found?.channel.id).toBe(channelId);
  });
});
