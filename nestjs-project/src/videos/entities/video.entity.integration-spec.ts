import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, QueryFailedError, type Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { CreateUsersAndChannels1775687773260 } from '../../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794273602577 } from '../../database/migrations/1794273602577-CreateVideos';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoPublicIdService } from '../video-public-id.service';
import { VideosDataModule } from '../videos-data.module';
import { VideosRepository } from '../videos.repository';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const MIGRATIONS = [
  CreateUsersAndChannels1775687773260,
  CreateAuthTokens1777579850478,
  CreateVideos1794273602577,
];
const TEN_GB = 10_737_418_240;

describe('Video entity (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let videosRepository: VideosRepository;
  let publicIds: VideoPublicIdService;
  let counter = 0;

  beforeAll(async () => {
    // The seq sequence only exists via migrations, so the schema comes from them.
    const options = createTestDataSource(ALL_ENTITIES, {
      synchronize: false,
      migrations: MIGRATIONS,
    }).options;
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(options),
        VideosDataModule,
      ],
    }).compile();

    dataSource = module.get(DataSource);
    await dataSource.runMigrations();
    videoRepository = dataSource.getRepository(Video);
    videosRepository = module.get(VideosRepository);
    publicIds = module.get(VideoPublicIdService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function createChannel(): Promise<Channel> {
    const user = await dataSource.getRepository(User).save({
      email: `video_owner_${++counter}_${Date.now()}@example.com`,
      password: 'hashed',
    });
    return dataSource.getRepository(Channel).save({
      name: 'Owner',
      nickname: `owner_${counter}_${Date.now()}`,
      user_id: user.id,
    });
  }

  async function buildVideo(
    channel: Channel,
    overrides: Partial<Video> = {},
  ): Promise<Partial<Video>> {
    const id = randomUUID();
    const seq = await videosRepository.reserveSeq();
    return {
      id,
      seq,
      public_id: publicIds.encode(seq),
      channel_id: channel.id,
      title: 'clip.mp4',
      original_filename: 'clip.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1024,
      storage_key: `videos/${id}/source`,
      ...overrides,
    };
  }

  it('should default status to DRAFT when not provided', async () => {
    const channel = await createChannel();
    const video = await buildVideo(channel);

    await videoRepository.insert(video);
    const saved = await videoRepository.findOneByOrFail({ id: video.id });

    expect(saved.status).toBe('DRAFT');
  });

  it('should persist the reserved seq and a public_id that decodes back to it', async () => {
    const channel = await createChannel();
    const video = await buildVideo(channel);

    await videoRepository.insert(video);
    const saved = await videoRepository.findOneByOrFail({ id: video.id });

    expect(saved.seq).toBe(video.seq);
    expect(saved.public_id.length).toBeGreaterThanOrEqual(10);
    expect(publicIds.decode(saved.public_id)).toBe(saved.seq);
  });

  it('should reserve increasing, distinct seqs', async () => {
    const first = await videosRepository.reserveSeq();
    const second = await videosRepository.reserveSeq();

    expect(second).toBeGreaterThan(first);
  });

  it('should reject two videos with the same public_id', async () => {
    const channel = await createChannel();
    const first = await buildVideo(channel);
    await videoRepository.insert(first);

    const duplicate = await buildVideo(channel, { public_id: first.public_id });

    await expect(videoRepository.insert(duplicate)).rejects.toBeInstanceOf(
      QueryFailedError,
    );
  });

  it('should reject two videos with the same seq', async () => {
    const channel = await createChannel();
    const first = await buildVideo(channel);
    await videoRepository.insert(first);

    const duplicate = await buildVideo(channel, { seq: first.seq });

    await expect(videoRepository.insert(duplicate)).rejects.toBeInstanceOf(
      QueryFailedError,
    );
  });

  it('should delete the videos of a channel when the channel is deleted', async () => {
    const channel = await createChannel();
    const video = await buildVideo(channel);
    await videoRepository.insert(video);

    await dataSource.getRepository(Channel).delete({ id: channel.id });

    expect(await videoRepository.countBy({ id: video.id })).toBe(0);
  });

  it('should read a size_bytes above 2^31 back as the same number', async () => {
    const channel = await createChannel();
    const video = await buildVideo(channel, { size_bytes: TEN_GB });

    await videoRepository.insert(video);
    const saved = await videoRepository.findOneByOrFail({ id: video.id });

    expect(saved.size_bytes).toBe(TEN_GB);
    expect(typeof saved.size_bytes).toBe('number');
  });
});
