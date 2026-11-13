import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video } from './video.entity';
import { VideoStatus } from '../enums/video-status.enum';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let userCounter = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
  });

  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );

    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${userCounter}`,
        nickname: `video_channel_${userCounter}`,
        user_id: user.id,
      }),
    );
  }

  it('defaults a new video to DRAFT and generates its UUID', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create({ channel_id: channel.id }),
    );

    expect(video.id).toEqual(expect.any(String));
    expect(video.status).toBe(VideoStatus.DRAFT);
  });

  it('persists processing metadata and nullable storage fields', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        status: VideoStatus.READY,
        storage_key: 'videos/video-id/source.mp4',
        thumbnail_key: 'videos/video-id/thumbnail.jpg',
        file_size: '1024',
        duration_seconds: 12.5,
        metadata: { codec: 'h264' },
      }),
    );

    const found = await videoRepository.findOneByOrFail({ id: video.id });
    expect(found.status).toBe(VideoStatus.READY);
    expect(found.file_size).toBe('1024');
    expect(found.metadata).toEqual({ codec: 'h264' });
  });

  it('enforces unique storage and upload identifiers', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        storage_key: 'videos/unique/source.mp4',
        upload_id: 'upload-unique',
      }),
    );

    await expect(
      videoRepository.save(
        videoRepository.create({
          channel_id: channel.id,
          storage_key: 'videos/unique/source.mp4',
          upload_id: 'upload-other',
        }),
      ),
    ).rejects.toThrow();
  });

  it('loads the owning channel relation', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create({ channel_id: channel.id }),
    );

    const found = await videoRepository.findOne({
      where: { id: video.id },
      relations: ['channel'],
    });

    expect(found?.channel.nickname).toBe(channel.nickname);
  });
});
