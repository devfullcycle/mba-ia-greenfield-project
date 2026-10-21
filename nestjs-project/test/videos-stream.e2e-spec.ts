import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/videos.constants';

interface ErrorBody {
  error: string;
}

describe('GET /videos/:publicId/stream (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let publicId: string;
  let readyId: string;
  let processingId: string;
  const openUploads: { key: string; uploadId: string }[] = [];

  beforeAll(async () => {
    // Tests run inside the container: sign against the internal storage host.
    process.env.STORAGE_PUBLIC_ENDPOINT = process.env.STORAGE_ENDPOINT;
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
    storage = moduleFixture.get(StorageService);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await Promise.all(
      openUploads.map((u) => storage.abortMultipartUpload(u.key, u.uploadId)),
    );
    await cleanAllTables(dataSource);
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
    ownerToken = await registerConfirmAndLogin('owner@example.com');
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        filename: 'clip.mp4',
        size_bytes: 1024,
        content_type: 'video/mp4',
      })
      .expect(201);
    const body = res.body as { public_id: string; upload_id: string };
    publicId = body.public_id;
    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: publicId });
    openUploads.push({ key: video.storage_key, uploadId: body.upload_id });
    readyId = await startVideo(VideoStatus.READY, true);
    processingId = await startVideo(VideoStatus.PROCESSING);
  });

  async function startVideo(
    status: VideoStatus,
    withObject = false,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        filename: 'clip.mp4',
        size_bytes: 1024,
        content_type: 'video/mp4',
      })
      .expect(201);
    const body = res.body as { public_id: string; upload_id: string };
    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: body.public_id });
    openUploads.push({ key: video.storage_key, uploadId: body.upload_id });
    if (withObject) {
      await storage.putObject(
        video.storage_key,
        Buffer.alloc(1024, 7),
        'video/mp4',
      );
    }
    await dataSource.getRepository(Video).update({ id: video.id }, { status });
    return body.public_id;
  }

  async function registerConfirmAndLogin(email: string): Promise<string> {
    const password = 'password123';
    const mailService = app.get(MailService);
    let token = '';
    jest
      .spyOn(mailService, 'sendConfirmationEmail')
      .mockImplementationOnce((_e: string, _n: string, t: string) => {
        token = t;
        return Promise.resolve();
      });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return (res.body as { access_token: string }).access_token;
  }

  const stream = (id: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/videos/${id}/stream`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('returns 200 with url and expires_in to the owner of a ready video', async () => {
    const res = await stream(readyId, ownerToken).expect(200);

    const body = res.body as { url: string; expires_in: number };
    expect(body.url).toMatch(/^https?:\/\//);
    expect(body.expires_in).toBeGreaterThan(0);
  });

  it('returns a url that answers a Range request with 206', async () => {
    const res = await stream(readyId, ownerToken).expect(200);
    const { url } = res.body as { url: string };

    const response = await fetch(url, { headers: { Range: 'bytes=0-99' } });

    expect(response.status).toBe(206);
    expect((await response.arrayBuffer()).byteLength).toBe(100);
  });

  it('returns 409 VIDEO_NOT_READY while the video is processing', async () => {
    const res = await stream(processingId, ownerToken).expect(409);

    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_READY');
  });

  it('returns 404 VIDEO_NOT_FOUND to an anonymous caller on a draft', async () => {
    const res = await stream(publicId).expect(404);

    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
  });
});
