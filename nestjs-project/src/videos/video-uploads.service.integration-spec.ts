import {
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { ChannelsModule } from '../channels/channels.module';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import { CreateUsersAndChannels1775687773260 } from '../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794273602577 } from '../database/migrations/1794273602577-CreateVideos';
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
});
