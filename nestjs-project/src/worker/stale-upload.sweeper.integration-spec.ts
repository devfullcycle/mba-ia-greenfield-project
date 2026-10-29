// Presigned part URLs are signed with the public storage endpoint, which
// (`localhost`) is not reachable from inside the test container. Point it at
// the internal endpoint before the config is read.
process.env.S3_PUBLIC_ENDPOINT = process.env.S3_ENDPOINT;

import { randomUUID } from 'crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { ProcessingStatus } from '../videos/video.enums';
import { StaleUploadSweeper } from './stale-upload.sweeper';
import { STALE_UPLOAD_MAX_AGE_MS } from './worker.constants';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const HOUR_MS = 60 * 60 * 1000;

describe('StaleUploadSweeper (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let module: TestingModule;
  let storageService: StorageService;
  let sweeper: StaleUploadSweeper;
  let channelId: string;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    storageService = module.get(StorageService);
    sweeper = new StaleUploadSweeper(videoRepository, storageService);
  });

  afterAll(async () => {
    await module.close();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await userRepository.save(
      userRepository.create({
        email: 'sweeper@example.com',
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Sweeper',
        nickname: 'sweeper',
        user_id: user.id,
      }),
    );
    channelId = channel.id;
  });

  /** Creates an UPLOADING video with a real open multipart upload, aged `ageMs`. */
  async function createUploadingVideo(
    publicId: string,
    ageMs: number,
  ): Promise<Video> {
    const id = randomUUID();
    const objectKey = `test/${id}/original.mp4`;
    const uploadId = await storageService.createMultipartUpload(
      objectKey,
      'video/mp4',
    );
    const video = await videoRepository.save(
      videoRepository.create({
        id,
        publicId,
        channelId,
        originalFilename: 'clip.mp4',
        contentType: 'video/mp4',
        sizeBytes: '1000',
        objectKey,
        uploadId,
      }),
    );
    // updated_at is maintained by TypeORM, so age the row with raw SQL.
    await dataSource.query(
      `UPDATE "videos" SET "updated_at" = $1 WHERE "id" = $2`,
      [new Date(Date.now() - ageMs), id],
    );
    return video;
  }

  async function partUrlStillWorks(video: Video): Promise<boolean> {
    const url = await storageService.presignUploadPart(
      video.objectKey,
      video.uploadId!,
      1,
    );
    const response = await fetch(url, {
      method: 'PUT',
      body: Buffer.alloc(16, 'a'),
    });
    return response.ok;
  }

  it('should fail a stale upload and release its multipart upload in storage', async () => {
    const stale = await createUploadingVideo(
      'stalevideo1',
      STALE_UPLOAD_MAX_AGE_MS + HOUR_MS,
    );

    const result = await sweeper.sweep();

    const stored = await videoRepository.findOneByOrFail({ id: stale.id });
    expect(stored.processingStatus).toBe(ProcessingStatus.FAILED);
    expect(stored.failureReason).toEqual(expect.any(String));
    expect(stored.uploadId).toBeNull();
    expect(result).toEqual({ swept: 1, skipped: 0 });
    expect(await partUrlStillWorks(stale)).toBe(false);
  });

  it('should leave a recent upload untouched and its multipart upload open', async () => {
    const recent = await createUploadingVideo(
      'recentvideo',
      STALE_UPLOAD_MAX_AGE_MS - HOUR_MS,
    );

    const result = await sweeper.sweep();

    const stored = await videoRepository.findOneByOrFail({ id: recent.id });
    expect(stored.processingStatus).toBe(ProcessingStatus.UPLOADING);
    expect(stored.uploadId).toBe(recent.uploadId);
    expect(result.swept).toBe(0);
    expect(await partUrlStillWorks(recent)).toBe(true);
    await storageService.abortMultipartUpload(
      recent.objectKey,
      recent.uploadId!,
    );
  });

  it('should only touch UPLOADING videos, never processing or ready ones', async () => {
    const processing = await createUploadingVideo(
      'procvideo01',
      STALE_UPLOAD_MAX_AGE_MS + HOUR_MS,
    );
    await dataSource.query(
      `UPDATE "videos" SET "processing_status" = 'PROCESSING', "upload_id" = NULL WHERE "id" = $1`,
      [processing.id],
    );

    await sweeper.sweep();

    const stored = await videoRepository.findOneByOrFail({ id: processing.id });
    expect(stored.processingStatus).toBe(ProcessingStatus.PROCESSING);
  });

  it('should be safe to run twice in a row', async () => {
    await createUploadingVideo(
      'stalevideo2',
      STALE_UPLOAD_MAX_AGE_MS + HOUR_MS,
    );

    const first = await sweeper.sweep();
    const second = await sweeper.sweep();

    expect(first.swept).toBe(1);
    expect(second).toEqual({ swept: 0, skipped: 0 });
  });
});
