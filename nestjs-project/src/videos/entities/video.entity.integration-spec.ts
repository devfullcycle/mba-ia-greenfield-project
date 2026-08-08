import { DataSource } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { Video, VideoStatus } from './video.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let user: User;
  let channel: Channel;

  beforeAll(async () => {
    dataSource = createTestDataSource([User, Channel, Video]);
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);

    const userRepo = dataSource.getRepository(User);
    const channelRepo = dataSource.getRepository(Channel);

    user = await userRepo.save(
      userRepo.create({
        email: 'videoowner@example.com',
        password: 'hashedpassword',
        is_confirmed: true,
      }),
    );

    channel = await channelRepo.save(
      channelRepo.create({
        name: 'Video Channel',
        nickname: 'videochannel',
        user_id: user.id,
      }),
    );
  });

  it('should create a video with default status draft', async () => {
    const videoRepo = dataSource.getRepository(Video);

    const video = await videoRepo.save(
      videoRepo.create({
        url_code: 'abc123xyz789',
        title: 'Test Video',
        channel_id: channel.id,
        original_filename: 'test.mp4',
      }),
    );

    expect(video.id).toBeDefined();
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.created_at).toBeDefined();
  });

  it('should enforce unique constraint on url_code', async () => {
    const videoRepo = dataSource.getRepository(Video);

    await videoRepo.save(
      videoRepo.create({
        url_code: 'uniqueurl123',
        title: 'Video 1',
        channel_id: channel.id,
        original_filename: 'v1.mp4',
      }),
    );

    await expect(
      videoRepo.save(
        videoRepo.create({
          url_code: 'uniqueurl123',
          title: 'Video 2',
          channel_id: channel.id,
          original_filename: 'v2.mp4',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should load the owning channel through the foreign key relation', async () => {
    const videoRepo = dataSource.getRepository(Video);

    const video = await videoRepo.save(
      videoRepo.create({
        url_code: 'relation1234',
        title: 'Relation Video',
        channel_id: channel.id,
        original_filename: 'relation.mp4',
      }),
    );

    const found = await videoRepo.findOne({
      where: { id: video.id },
      relations: ['channel'],
    });

    expect(found?.channel).toBeDefined();
    expect(found?.channel.id).toBe(channel.id);
  });

  it('should reject a video referencing a non-existent channel', async () => {
    const videoRepo = dataSource.getRepository(Video);

    await expect(
      videoRepo.save(
        videoRepo.create({
          url_code: 'invalidchan1',
          title: 'Orphan Video',
          channel_id: '00000000-0000-0000-0000-000000000000',
          original_filename: 'orphan.mp4',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should auto-populate created_at and updated_at timestamps', async () => {
    const videoRepo = dataSource.getRepository(Video);

    const video = await videoRepo.save(
      videoRepo.create({
        url_code: 'timestamptst',
        title: 'Timestamp Video',
        channel_id: channel.id,
        original_filename: 'timestamp.mp4',
      }),
    );

    expect(video.created_at).toBeInstanceOf(Date);
    expect(video.updated_at).toBeInstanceOf(Date);
  });
});
