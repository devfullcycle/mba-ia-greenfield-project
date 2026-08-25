import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

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
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    counter += 1;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${counter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${counter}`,
        nickname: `chan_${counter}`,
        user_id: user.id,
      }),
    );
  }

  it('should default status to rascunho', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create({
        public_id: 'abc123xyz0',
        channel_id: channel.id,
        original_filename: 'video.mp4',
      }),
    );

    expect(video.status).toBe(VideoStatus.RASCUNHO);
  });

  it('should enforce unique public_id constraint', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create({
        public_id: 'dupe000001',
        channel_id: channel.id,
        original_filename: 'video.mp4',
      }),
    );

    await expect(
      videoRepository.save(
        videoRepository.create({
          public_id: 'dupe000001',
          channel_id: channel.id,
          original_filename: 'other.mp4',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should reject an invalid status value', async () => {
    const channel = await createChannel();

    await expect(
      videoRepository.save(
        videoRepository.create({
          public_id: 'badstatus1',
          channel_id: channel.id,
          original_filename: 'video.mp4',
          status: 'invalid-status' as VideoStatus,
        }),
      ),
    ).rejects.toThrow();
  });

  it('should reject a video with a non-existent channel_id (FK constraint)', async () => {
    await expect(
      videoRepository.save(
        videoRepository.create({
          public_id: 'nochannel1',
          channel_id: '00000000-0000-0000-0000-000000000000',
          original_filename: 'video.mp4',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should allow nullable processing fields to be null', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create({
        public_id: 'nullable01',
        channel_id: channel.id,
        original_filename: 'video.mp4',
      }),
    );

    expect(video.original_key).toBeNull();
    expect(video.thumbnail_key).toBeNull();
    expect(video.duration_seconds).toBeNull();
    expect(video.processing_error).toBeNull();
  });
});
