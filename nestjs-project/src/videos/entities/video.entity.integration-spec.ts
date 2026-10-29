import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { ProcessingStatus, PublicationState } from '../video.enums';
import { Video } from './video.entity';

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
    const n = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_owner_${n}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${n}`,
        nickname: `video_owner_${n}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(channelId: string, publicId: string): Partial<Video> {
    return {
      publicId,
      channelId,
      originalFilename: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: '1073741824',
      objectKey: 'videos/some-id/original.mp4',
    };
  }

  it('should apply UPLOADING and DRAFT defaults and null optional fields', async () => {
    const channel = await createChannel();

    const video = await videoRepository.save(
      videoRepository.create(buildVideo(channel.id, 'abcdefghijk')),
    );
    const found = await videoRepository.findOneByOrFail({ id: video.id });

    expect(found.processingStatus).toBe(ProcessingStatus.UPLOADING);
    expect(found.publicationState).toBe(PublicationState.DRAFT);
    expect(found.uploadId).toBeNull();
    expect(found.failureReason).toBeNull();
    expect(found.durationSeconds).toBeNull();
    expect(found.metadata).toBeNull();
    expect(found.createdAt).toBeInstanceOf(Date);
    expect(found.updatedAt).toBeInstanceOf(Date);
  });

  it('should enforce a unique publicId', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create(buildVideo(channel.id, 'abcdefghijk')),
    );

    await expect(
      videoRepository.save(
        videoRepository.create(buildVideo(channel.id, 'abcdefghijk')),
      ),
    ).rejects.toThrow();
  });

  it('should reject a publicId longer than 11 characters', async () => {
    const channel = await createChannel();

    await expect(
      videoRepository.save(
        videoRepository.create(buildVideo(channel.id, 'abcdefghijkl')),
      ),
    ).rejects.toThrow();
  });

  it('should reject a video whose channelId does not exist', async () => {
    await expect(
      videoRepository.save(
        videoRepository.create(
          buildVideo('00000000-0000-4000-8000-000000000000', 'abcdefghijk'),
        ),
      ),
    ).rejects.toThrow();
  });

  it('should reject an invalid processingStatus value', async () => {
    const channel = await createChannel();

    await expect(
      dataSource.query(
        `INSERT INTO "videos" ("public_id", "channel_id", "original_filename", "content_type", "size_bytes", "object_key", "processing_status")
         VALUES ('abcdefghijk', $1, 'clip.mp4', 'video/mp4', 1, 'k', 'BOGUS')`,
        [channel.id],
      ),
    ).rejects.toThrow();
  });

  it('should persist the video status transition and jsonb metadata', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create(buildVideo(channel.id, 'abcdefghijk')),
    );

    await videoRepository.update(video.id, {
      processingStatus: ProcessingStatus.READY,
      durationSeconds: '12.5',
      metadata: { codec: 'h264', width: 1920 },
    });
    const found = await videoRepository.findOneByOrFail({ id: video.id });

    expect(found.processingStatus).toBe(ProcessingStatus.READY);
    expect(Number(found.durationSeconds)).toBe(12.5);
    expect(found.metadata).toEqual({ codec: 'h264', width: 1920 });
  });

  it('should load videos through the Channel one-to-many relation', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create(buildVideo(channel.id, 'abcdefghijk')),
    );
    await videoRepository.save(
      videoRepository.create(buildVideo(channel.id, 'lmnopqrstuv')),
    );

    const found = await channelRepository.findOneOrFail({
      where: { id: channel.id },
      relations: ['videos'],
    });

    expect(found.videos).toHaveLength(2);
  });
});
