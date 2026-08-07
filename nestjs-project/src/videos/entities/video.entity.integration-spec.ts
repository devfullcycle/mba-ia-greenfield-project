import type { DataSource, Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { Video } from './video.entity';
import { VideoStatus } from '../video-status';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let channels: Repository<Channel>;
  let users: Repository<User>;
  let channelId: string;

  beforeAll(async () => {
    dataSource = createTestDataSource([User, Channel, Video], {
      synchronize: false,
    });
    await dataSource.initialize();
    videos = dataSource.getRepository(Video);
    channels = dataSource.getRepository(Channel);
    users = dataSource.getRepository(User);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);

    const user = await users.save(
      users.create({ email: `owner-${Date.now()}@test.local`, password: 'x' }),
    );
    const channel = await channels.save(
      channels.create({
        name: 'Owner Channel',
        nickname: `owner_${Date.now()}`,
        user_id: user.id,
      }),
    );
    channelId = channel.id;
  });

  function buildVideo(overrides: Partial<Video> = {}): Video {
    return videos.create({
      public_id: `pub${Date.now().toString(36)}`,
      channel_id: channelId,
      title: 'My Video',
      storage_key: 'videos/x/source',
      content_type: 'video/mp4',
      ...overrides,
    });
  }

  it('defaults status to draft', async () => {
    const saved = await videos.save(buildVideo());
    const found = await videos.findOneByOrFail({ id: saved.id });
    expect(found.status).toBe(VideoStatus.DRAFT);
    expect(found.created_at).toBeInstanceOf(Date);
    expect(found.thumbnail_key).toBeNull();
    expect(found.duration_seconds).toBeNull();
    expect(found.failure_reason).toBeNull();
  });

  it('enforces unique public_id', async () => {
    const publicId = `dup${Date.now().toString(36)}`;
    await videos.save(buildVideo({ public_id: publicId }));
    await expect(
      videos.save(buildVideo({ public_id: publicId })),
    ).rejects.toThrow();
  });

  it('persists jsonb metadata and bigint size, and resolves the channel relation', async () => {
    const saved = await videos.save(
      buildVideo({
        size_bytes: 10_737_418_240,
        duration_seconds: 42,
        metadata: { codec: 'h264', width: 1920, height: 1080 },
        status: VideoStatus.READY,
        thumbnail_key: 'videos/x/thumbnail.jpg',
      }),
    );

    const found = await videos.findOneOrFail({
      where: { id: saved.id },
      relations: { channel: true },
    });
    expect(found.size_bytes).toBe(10_737_418_240);
    expect(found.duration_seconds).toBe(42);
    expect(found.metadata).toEqual({
      codec: 'h264',
      width: 1920,
      height: 1080,
    });
    expect(found.channel.id).toBe(channelId);
  });

  it('rejects a video pointing to a non-existent channel (FK)', async () => {
    await expect(
      videos.save(
        buildVideo({ channel_id: '00000000-0000-0000-0000-000000000000' }),
      ),
    ).rejects.toThrow();
  });
});
