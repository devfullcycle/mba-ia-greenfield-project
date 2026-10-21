import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import databaseConfig from '../config/database.config';
import storageConfig from '../config/storage.config';
import { QueueService } from '../queue/queue.service';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/videos.constants';
import { UploadReaperHandler } from './upload-reaper.handler';
import { UPLOAD_INACTIVITY_LIMIT_MS } from './worker.constants';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const LONG_AGO = new Date(Date.now() - UPLOAD_INACTIVITY_LIMIT_MS - 3600_000);

describe('UploadReaperHandler (integration)', () => {
  let module: TestingModule;
  let handler: UploadReaperHandler;
  let storage: StorageService;
  let dataSource: DataSource;
  let channel: Channel;
  let counter = 0;
  const openUploads: { key: string; uploadId: string }[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig, storageConfig],
        }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({
            ...createTestDataSource(ALL_ENTITIES).options,
            autoLoadEntities: true,
          }),
        }),
        TypeOrmModule.forFeature([Video]),
        StorageModule,
      ],
      providers: [
        UploadReaperHandler,
        // Bootstrap (work + schedule) is never run in this spec.
        { provide: QueueService, useValue: { work: jest.fn() } },
      ],
    }).compile();
    handler = module.get(UploadReaperHandler);
    storage = module.get(StorageService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await Promise.all(
      openUploads.map((u) =>
        storage.abortMultipartUpload(u.key, u.uploadId).catch(() => undefined),
      ),
    );
    await cleanAllTables(dataSource);
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'owner@example.com', password: 'hashed' });
    channel = await dataSource
      .getRepository(Channel)
      .save({ name: 'Owner', nickname: 'owner', user_id: user.id });
  });

  const createUpload = async (
    options: { status?: VideoStatus; updatedAt?: Date; open?: boolean } = {},
  ) => {
    const { status = VideoStatus.UPLOADING, updatedAt, open = true } = options;
    const publicId = `reaper${String(++counter).padStart(5, '0')}`;
    const key = `videos/${publicId}/original`;
    const uploadId = open
      ? await storage.createMultipartUpload(key, 'video/mp4')
      : null;
    if (uploadId) openUploads.push({ key, uploadId });
    const video = await dataSource.getRepository(Video).save({
      public_id: publicId,
      channel_id: channel.id,
      status,
      original_filename: 'clip.mp4',
      size_bytes: 1024,
      storage_key: key,
      upload_id: uploadId,
    });
    if (updatedAt) {
      // `updated_at` is maintained by TypeORM, so backdate it with raw SQL.
      await dataSource.query(
        'UPDATE videos SET updated_at = $1 WHERE id = $2',
        [updatedAt, video.id],
      );
    }
    return { video, key, uploadId };
  };

  const exists = async (id: string) =>
    (await dataSource.getRepository(Video).countBy({ id })) === 1;
  const multipartOpen = async (key: string, uploadId: string) =>
    (await storage.listMultipartUploads(key)).some(
      (u) => u.uploadId === uploadId,
    );

  it('should delete an abandoned upload and abort its multipart', async () => {
    const stale = await createUpload({ updatedAt: LONG_AGO });

    await expect(handler.reap()).resolves.toBe(1);

    expect(await exists(stale.video.id)).toBe(false);
    expect(await multipartOpen(stale.key, stale.uploadId!)).toBe(false);
  });

  it('should leave an upload still within the limit untouched', async () => {
    const fresh = await createUpload();

    await expect(handler.reap()).resolves.toBe(0);

    expect(await exists(fresh.video.id)).toBe(true);
    expect(await multipartOpen(fresh.key, fresh.uploadId!)).toBe(true);
  });

  it('should never touch a completed upload, however old', async () => {
    const done = await createUpload({
      status: VideoStatus.PROCESSING,
      updatedAt: LONG_AGO,
      open: false,
    });

    await expect(handler.reap()).resolves.toBe(0);

    expect(await exists(done.video.id)).toBe(true);
  });

  it('should be safe to run twice over the same state', async () => {
    const stale = await createUpload({ updatedAt: LONG_AGO });
    const fresh = await createUpload();

    await expect(handler.reap()).resolves.toBe(1);
    await expect(handler.reap()).resolves.toBe(0);

    expect(await exists(stale.video.id)).toBe(false);
    expect(await exists(fresh.video.id)).toBe(true);
  });

  it('should still remove the row when the multipart was already aborted', async () => {
    const stale = await createUpload({ updatedAt: LONG_AGO });
    await storage.abortMultipartUpload(stale.key, stale.uploadId!);

    await expect(handler.reap()).resolves.toBe(1);

    expect(await exists(stale.video.id)).toBe(false);
  });
});
