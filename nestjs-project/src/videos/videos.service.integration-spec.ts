import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { ChannelsModule } from '../channels/channels.module';
import appConfig from '../config/app.config';
import authConfig from '../config/auth.config';
import databaseConfig from '../config/database.config';
import mailConfig from '../config/mail.config';
import storageConfig from '../config/storage.config';
import { QUEUES } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import {
  UploadAlreadyCompletedException,
  UploadIncompleteException,
  VideoForbiddenException,
} from '../common/exceptions/domain.exception';
import { Video } from './entities/video.entity';
import * as publicIdUtil from './public-id.util';
import { VideoStatus, VideoVisibility } from './videos.constants';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const dto = {
  filename: 'clip.mp4',
  size_bytes: 2048,
  content_type: 'video/mp4',
};

describe('VideosService (integration)', () => {
  let module: TestingModule;
  let service: VideosService;
  let storage: StorageService;
  let queue: QueueService;
  let dataSource: DataSource;
  let user: User;
  const openUploads: { key: string; uploadId: string }[] = [];

  beforeAll(async () => {
    // Tests run inside the container: sign against the internal storage host.
    process.env.STORAGE_PUBLIC_ENDPOINT = process.env.STORAGE_ENDPOINT;
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            appConfig,
            databaseConfig,
            storageConfig,
            authConfig,
            mailConfig,
          ],
        }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({
            ...createTestDataSource(ALL_ENTITIES).options,
            autoLoadEntities: true,
          }),
        }),
        ChannelsModule,
        VideosModule,
      ],
    }).compile();
    await module.init();
    service = module.get(VideosService);
    queue = module.get(QueueService);
    storage = module.get(StorageService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await Promise.all(
      openUploads.map((u) => storage.abortMultipartUpload(u.key, u.uploadId)),
    );
    await cleanAllTables(dataSource);
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    user = await dataSource
      .getRepository(User)
      .save({ email: 'owner@example.com', password: 'hashed' });
    await dataSource
      .getRepository(Channel)
      .save({ name: 'Owner', nickname: 'owner', user_id: user.id });
  });

  afterEach(() => jest.restoreAllMocks());

  const jobsFor = async (videoId: string) =>
    dataSource.query<{ id: string }[]>(
      `SELECT id FROM pgboss.job WHERE name = $1 AND data->>'videoId' = $2`,
      [QUEUES.VIDEO_PROCESS, videoId],
    );

  const uploadSinglePart = async (video: Video, uploadId: string) => {
    const [{ url }] = await service.signParts(
      { sub: user.id, email: user.email },
      video.public_id,
      [1],
    );
    const response = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(randomBytes(1024)),
    });
    expect(response.status).toBe(200);
    expect(uploadId).toBe(video.upload_id);
    return [{ part_number: 1, etag: response.headers.get('etag')! }];
  };

  const start = async () => {
    const result = await service.startUpload(
      { sub: user.id, email: user.email },
      dto,
    );
    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: result.public_id });
    openUploads.push({ key: video.storage_key, uploadId: result.upload_id });
    return { result, video };
  };

  it('should persist a draft video with a public_id and the open upload_id', async () => {
    const { result, video } = await start();

    expect(result.public_id).toHaveLength(11);
    expect(video.visibility).toBe(VideoVisibility.DRAFT);
    expect(video.status).toBe(VideoStatus.UPLOADING);
    expect(video.upload_id).toBe(result.upload_id);
    expect(video.upload_id).toBeTruthy();
    expect(video.original_filename).toBe('clip.mp4');
    const channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: user.id });
    expect(video.channel_id).toBe(channel.id);
    const open = await storage.listMultipartUploads(video.storage_key);
    expect(open.map((u) => u.uploadId)).toContain(result.upload_id);
  });

  it('should create the video with a new public_id when the first one collides', async () => {
    const { video: existing } = await start();
    jest
      .spyOn(publicIdUtil, 'generatePublicId')
      .mockReturnValueOnce(existing.public_id)
      .mockReturnValueOnce('freshId_001');

    const { result } = await start();

    expect(result.public_id).toBe('freshId_001');
    expect(await dataSource.getRepository(Video).count()).toBe(2);
  });
  describe('completeUpload', () => {
    const owner = () => ({ sub: user.id, email: user.email });

    it('should update the video and leave a video.process job with its id', async () => {
      const { video } = await start();
      const parts = await uploadSinglePart(video, video.upload_id!);

      const result = await service.completeUpload(owner(), video.public_id, {
        parts,
      });

      expect(result).toEqual({
        public_id: video.public_id,
        status: VideoStatus.PROCESSING,
      });
      const updated = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: video.id });
      expect(updated.status).toBe(VideoStatus.PROCESSING);
      expect(updated.upload_id).toBeNull();
      expect(await jobsFor(video.id)).toHaveLength(1);
      await expect(
        service.completeUpload(owner(), video.public_id, { parts }),
      ).rejects.toBeInstanceOf(UploadAlreadyCompletedException);
    });

    it('should enqueue no job and keep the previous state when the transaction fails', async () => {
      const { video } = await start();
      const parts = await uploadSinglePart(video, video.upload_id!);
      const realEnqueue = queue.enqueue.bind(queue) as QueueService['enqueue'];
      const enqueueSpy: jest.SpyInstance<
        ReturnType<QueueService['enqueue']>,
        Parameters<QueueService['enqueue']>
      > = jest.spyOn(queue, 'enqueue');
      enqueueSpy.mockImplementationOnce(async (...args) => {
        await realEnqueue(...args);
        throw new Error('boom');
      });

      await expect(
        service.completeUpload(owner(), video.public_id, { parts }),
      ).rejects.toThrow('boom');

      const unchanged = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: video.id });
      expect(unchanged.status).toBe(VideoStatus.UPLOADING);
      expect(unchanged.upload_id).toBe(video.upload_id);
      expect(await jobsFor(video.id)).toHaveLength(0);
    });

    it('should throw UPLOAD_INCOMPLETE when the storage refuses the parts', async () => {
      const { video } = await start();

      await expect(
        service.completeUpload(owner(), video.public_id, {
          parts: [{ part_number: 1, etag: '"missing"' }],
        }),
      ).rejects.toBeInstanceOf(UploadIncompleteException);
      const unchanged = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: video.id });
      expect(unchanged.status).toBe(VideoStatus.UPLOADING);
    });

    it('should throw VIDEO_FORBIDDEN when another channel signs parts', async () => {
      const { video } = await start();
      const other = await dataSource
        .getRepository(User)
        .save({ email: 'other@example.com', password: 'hashed' });
      await dataSource
        .getRepository(Channel)
        .save({ name: 'Other', nickname: 'other', user_id: other.id });

      await expect(
        service.signParts(
          { sub: other.id, email: other.email },
          video.public_id,
          [1],
        ),
      ).rejects.toBeInstanceOf(VideoForbiddenException);
    });
  });

  describe('getPlaybackUrl', () => {
    it('should presign a URL that serves the object with Range', async () => {
      const { video } = await start();
      const body = Buffer.from('0123456789');
      await storage.putObject(video.storage_key, body, 'video/mp4');
      await dataSource
        .getRepository(Video)
        .update({ id: video.id }, { status: VideoStatus.READY });

      const { url, expires_in } = await service.getPlaybackUrl(
        video.public_id,
        { sub: user.id, email: user.email },
        { download: false },
      );
      const response = await fetch(url, { headers: { Range: 'bytes=2-5' } });

      expect(expires_in).toBeGreaterThan(0);
      expect(response.status).toBe(206);
      expect(await response.text()).toBe('2345');
    });
  });
});
