import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoStatus, VideoVisibility } from '../videos.constants';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channel: Channel;

  const newVideo = (overrides: Partial<Video> = {}) =>
    videoRepository.create({
      public_id: 'abcDEF12345',
      channel_id: channel.id,
      status: VideoStatus.UPLOADING,
      original_filename: 'clip.mp4',
      size_bytes: 1024,
      storage_key: 'videos/abcDEF12345/original',
      ...overrides,
    });

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save({
      email: 'owner@example.com',
      password: 'hashed',
    });
    channel = await dataSource.getRepository(Channel).save({
      name: 'Owner',
      nickname: 'owner',
      user_id: user.id,
    });
  });

  it('should persist a video without visibility as a draft with generated id and timestamps', async () => {
    const saved = await videoRepository.save(newVideo());

    const found = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(found.visibility).toBe(VideoVisibility.DRAFT);
    expect(found.created_at).toBeInstanceOf(Date);
    expect(found.updated_at).toBeInstanceOf(Date);
    expect(found.upload_id).toBeNull();
    expect(found.metadata).toBeNull();
  });

  it('should round-trip bigint size and jsonb metadata', async () => {
    const size = 10 * 1024 * 1024 * 1024;
    const saved = await videoRepository.save(
      newVideo({
        size_bytes: size,
        duration_seconds: 12.5,
        metadata: { format: { duration: '12.5' } },
      }),
    );

    const found = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(found.size_bytes).toBe(size);
    expect(found.duration_seconds).toBe(12.5);
    expect(found.metadata).toEqual({ format: { duration: '12.5' } });
  });

  it('should reject two videos with the same public_id', async () => {
    await videoRepository.save(newVideo());

    await expect(
      videoRepository.save(newVideo({ storage_key: 'videos/other/original' })),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('should reject a video whose channel_id does not exist', async () => {
    await expect(
      videoRepository.save(
        newVideo({ channel_id: '00000000-0000-4000-8000-000000000000' }),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it.each(['status', 'original_filename', 'size_bytes', 'storage_key'])(
    'should reject a video with null %s',
    async (column) => {
      await expect(
        videoRepository.save(newVideo({ [column]: null } as Partial<Video>)),
      ).rejects.toThrow(/null value|not-null/i);
    },
  );
});
