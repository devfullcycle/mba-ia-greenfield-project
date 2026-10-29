// The presigned URL is signed with the public storage endpoint, which
// (`localhost`) is not reachable from inside the test container. Point it at
// the internal endpoint before the app reads the config.
process.env.S3_PUBLIC_ENDPOINT = process.env.S3_ENDPOINT;

import { randomUUID } from 'crypto';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import storageConfig from '../src/config/storage.config';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { S3_INTERNAL_CLIENT } from '../src/storage/storage.constants';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { registerConfirmAndLogin } from '../src/test/e2e-auth';
import { Video } from '../src/videos/entities/video.entity';
import { ProcessingStatus } from '../src/videos/video.enums';

interface ErrorBody {
  error: string;
}

const OBJECT_BYTES = 4096;

describe('GET /videos/:id/download (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let storageService: StorageService;
  let s3Client: S3Client;
  let throttlerStorage: ThrottlerStorageService;
  const createdKeys: string[] = [];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    videoRepository = dataSource.getRepository(Video);
    storageService = moduleFixture.get(StorageService, { strict: false });
    s3Client = moduleFixture.get<S3Client>(S3_INTERNAL_CLIENT, {
      strict: false,
    });
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    const { bucket } = storageConfig();
    await Promise.all(
      createdKeys.map((key) =>
        s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      ),
    );
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function ownerChannel(): Promise<Channel> {
    await registerConfirmAndLogin(app, 'owner@example.com');
    return dataSource.getRepository(Channel).findOneByOrFail({});
  }

  /** Inserts a video row; READY ones get a real object in storage. */
  async function createVideo(
    status: ProcessingStatus,
    publicId: string,
    originalFilename = 'clip.mp4',
  ): Promise<Video> {
    const channel = await ownerChannel();
    const id = randomUUID();
    const objectKey = `test/${id}/original.mp4`;
    if (status === ProcessingStatus.READY) {
      await storageService.putObject(
        objectKey,
        Buffer.alloc(OBJECT_BYTES, 'a'),
        'video/mp4',
      );
      createdKeys.push(objectKey);
    }
    return videoRepository.save(
      videoRepository.create({
        id,
        publicId,
        channelId: channel.id,
        originalFilename,
        contentType: 'video/mp4',
        sizeBytes: String(OBJECT_BYTES),
        objectKey,
        processingStatus: status,
      }),
    );
  }

  it('redirects to a URL that downloads the file as an attachment with the original name', async () => {
    const video = await createVideo(ProcessingStatus.READY, 'readyvideo1');

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.publicId}/download`)
      .redirects(0)
      .expect(302);
    const download = await fetch(res.headers.location);

    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toBe(
      'attachment; filename="clip.mp4"',
    );
    expect((await download.arrayBuffer()).byteLength).toBe(OBJECT_BYTES);
  });

  it('keeps a non-ASCII original name through an RFC 5987 filename*', async () => {
    const video = await createVideo(
      ProcessingStatus.READY,
      'accentvideo',
      'vídeo férias.mp4',
    );

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.publicId}/download`)
      .redirects(0)
      .expect(302);
    const download = await fetch(res.headers.location);

    expect(download.status).toBe(200);
    const disposition = download.headers.get('content-disposition')!;
    expect(disposition).toContain('attachment');
    expect(disposition).toContain(
      "filename*=UTF-8''v%C3%ADdeo%20f%C3%A9rias.mp4",
    );
  });

  it('returns 409 VIDEO_NOT_READY while the video is processing', async () => {
    const video = await createVideo(ProcessingStatus.PROCESSING, 'procvideo01');

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.publicId}/download`)
      .redirects(0)
      .expect(409);

    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_READY');
  });

  it('returns 404 VIDEO_NOT_FOUND for an unknown publicId', async () => {
    const res = await request(app.getHttpServer())
      .get('/videos/unknownid01/download')
      .redirects(0)
      .expect(404);

    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
  });
});
