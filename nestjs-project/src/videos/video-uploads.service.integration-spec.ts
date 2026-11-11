import {
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VideoNotInDraftException } from '../common/exceptions/domain.exception';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { ChannelsModule } from '../channels/channels.module';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import { CreateUsersAndChannels1775687773260 } from '../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794273602577 } from '../database/migrations/1794273602577-CreateVideos';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.constants';
import { QueueModule } from '../queue/queue.module';
import { S3_INTERNAL_CLIENT } from '../storage/storage.constants';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoPublicIdService } from './video-public-id.service';
import { VideoUploadsService } from './video-uploads.service';
import { VideosDataModule } from './videos-data.module';
import { VideosRepository } from './videos.repository';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const MIGRATIONS = [
  CreateUsersAndChannels1775687773260,
  CreateAuthTokens1777579850478,
  CreateVideos1794273602577,
];
const BUCKET = process.env.S3_BUCKET;

describe('VideoUploadsService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideoUploadsService;
  let storage: StorageService;
  let s3: S3Client;
  let user: User;
  let channel: Channel;
  let counter = 0;

  beforeAll(async () => {
    const options = createTestDataSource(ALL_ENTITIES, {
      synchronize: false,
      migrations: MIGRATIONS,
    }).options;
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(options),
        VideosDataModule,
        StorageModule,
        QueueModule,
        ChannelsModule,
      ],
      providers: [VideoUploadsService],
    }).compile();

    dataSource = module.get(DataSource);
    await dataSource.runMigrations();
    service = module.get(VideoUploadsService);
    storage = module.get(StorageService);
    s3 = module.get(S3_INTERNAL_CLIENT);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    user = await dataSource.getRepository(User).save({
      email: `uploader_${++counter}_${Date.now()}@example.com`,
      password: 'hashed',
    });
    channel = await module
      .get(ChannelsService)
      .createChannel(user.id, user.email);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function openUploadsFor(key: string): Promise<string[]> {
    const { Uploads } = await s3.send(
      new ListMultipartUploadsCommand({ Bucket: BUCKET, Prefix: key }),
    );
    return (Uploads ?? []).map((upload) => upload.UploadId!);
  }

  it('should pre-register a DRAFT video with upload_id and public_id', async () => {
    const result = await service.initiate(user.id, {
      original_filename: 'a.mp4',
      mime_type: 'video/mp4',
      size_bytes: 12 * 1024 * 1024,
    });

    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: result.id });
    expect(video.status).toBe('DRAFT');
    expect(video.channel_id).toBe(channel.id);
    expect(video.title).toBe('a.mp4');
    expect(video.storage_key).toBe(`videos/${video.id}/source`);
    expect(video.upload_id).toBeTruthy();
    expect(module.get(VideoPublicIdService).decode(result.id)).toBe(video.seq);
    expect(await openUploadsFor(video.storage_key)).toContain(video.upload_id);
    expect(result.part_count).toBe(3);
    expect(result.parts.map((part) => part.part_number)).toEqual([1, 2, 3]);

    await s3.send(
      new AbortMultipartUploadCommand({
        Bucket: BUCKET,
        Key: video.storage_key,
        UploadId: video.upload_id!,
      }),
    );
  });

  it('should abort the multipart upload when persisting the video fails', async () => {
    const createSpy = jest.spyOn(storage, 'createMultipartUpload');
    jest
      .spyOn(module.get(VideosRepository), 'insert')
      .mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.initiate(user.id, {
        original_filename: 'a.mp4',
        mime_type: 'video/mp4',
        size_bytes: 1024,
      }),
    ).rejects.toThrow('db down');

    const [storageKey] = createSpy.mock.calls[0];
    expect(await openUploadsFor(storageKey)).toHaveLength(0);
    expect(await dataSource.getRepository(Video).count()).toBe(0);
  });

  describe('renewParts / abort', () => {
    const initiateDraft = () =>
      service.initiate(user.id, {
        original_filename: 'a.mp4',
        mime_type: 'video/mp4',
        size_bytes: 12 * 1024 * 1024,
      });

    it('should issue renewed part URLs that accept a PUT', async () => {
      const { id } = await initiateDraft();

      const renewed = await service.renewParts(id, user.id, {
        part_numbers: [3],
      });

      expect(renewed.parts.map((part) => part.part_number)).toEqual([3]);
      const response = await fetch(renewed.parts[0].url, {
        method: 'PUT',
        body: new Uint8Array(1024),
      });
      expect(response.ok).toBe(true);
      expect(response.headers.get('etag')).toBeTruthy();

      await service.abort(id, user.id);
    });

    it('should remove the DRAFT row and invalidate the UploadId on abort', async () => {
      const { id } = await initiateDraft();
      const video = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ public_id: id });

      await service.abort(id, user.id);

      expect(
        await dataSource.getRepository(Video).countBy({ id: video.id }),
      ).toBe(0);
      expect(await openUploadsFor(video.storage_key)).toHaveLength(0);
    });

    it('should delete the DRAFT row when the multipart upload is already gone from storage', async () => {
      const { id } = await initiateDraft();
      const video = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ public_id: id });
      await s3.send(
        new AbortMultipartUploadCommand({
          Bucket: BUCKET,
          Key: video.storage_key,
          UploadId: video.upload_id!,
        }),
      );

      await service.abort(id, user.id);

      expect(
        await dataSource.getRepository(Video).countBy({ id: video.id }),
      ).toBe(0);
    });

    it('should not delete a video a concurrent complete moved to PROCESSING', async () => {
      const { id } = await initiateDraft();
      const repository = module.get(VideosRepository);
      const video = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ public_id: id });
      // Simulates complete winning the race between findOwnedDraft and the delete.
      jest
        .spyOn(storage, 'abortMultipartUpload')
        .mockImplementationOnce(async () => {
          await repository.transitionStatus(video.id, 'DRAFT', 'PROCESSING');
        });

      await expect(service.abort(id, user.id)).rejects.toBeInstanceOf(
        VideoNotInDraftException,
      );

      const after = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: video.id });
      expect(after.status).toBe('PROCESSING');
      await storage.abortMultipartUpload(video.storage_key, video.upload_id!);
    });
  });

  describe('complete', () => {
    const MIB = 1024 * 1024;

    afterEach(async () => {
      await module
        .get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE))
        .obliterate({ force: true });
    });

    it('should assemble the object, persist PROCESSING and enqueue process-video with jobId = video.id', async () => {
      const chunks = [Buffer.alloc(5 * MIB, 1), Buffer.alloc(MIB, 2)];
      const sizeBytes = chunks[0].length + chunks[1].length;
      const draft = await service.initiate(user.id, {
        original_filename: 'two-parts.mp4',
        mime_type: 'video/mp4',
        size_bytes: sizeBytes,
      });
      expect(draft.part_count).toBe(2);
      const parts = await Promise.all(
        draft.parts.map(async ({ part_number, url }) => {
          const response = await fetch(url, {
            method: 'PUT',
            body: new Uint8Array(chunks[part_number - 1]),
          });
          return { part_number, etag: response.headers.get('etag')! };
        }),
      );

      const result = await service.complete(draft.id, user.id, { parts });

      expect(result).toEqual({ id: draft.id, status: 'PROCESSING' });
      const video = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ public_id: draft.id });
      expect(video.status).toBe('PROCESSING');
      expect((await storage.headObject(video.storage_key)).contentLength).toBe(
        sizeBytes,
      );
      const job = await module
        .get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE))
        .getJob(video.id);
      expect(job?.name).toBe('process-video');
      expect(job?.data).toEqual({ videoId: video.id });
    });
  });
});
