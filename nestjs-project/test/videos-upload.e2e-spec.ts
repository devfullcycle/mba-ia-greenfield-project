import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('Videos upload (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;

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
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function registerConfirmAndLogin(email: string): Promise<string> {
    const authService = app.get(AuthService);
    const mailService = (authService as any).mailService;
    let token = '';
    jest
      .spyOn(mailService, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) => {
        token = t;
      });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'password123' });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' });
    return res.body.access_token;
  }

  const initBody = {
    title: 'My clip',
    filename: 'clip.mp4',
    contentType: 'video/mp4',
    size: 16,
  };

  it('returns 401 when initiating an upload without a token', async () => {
    await request(app.getHttpServer())
      .post('/videos')
      .send(initBody)
      .expect(401);
  });

  it('runs the full presigned multipart upload lifecycle', async () => {
    const accessToken = await registerConfirmAndLogin('uploader@example.com');

    // 1. init: creates draft + starts multipart, returns the part plan
    const initRes = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(initBody)
      .expect(201);

    expect(initRes.body.videoId).toBeDefined();
    expect(initRes.body.uploadId).toBeDefined();
    expect(initRes.body.partSize).toBeGreaterThan(0);
    expect(initRes.body.partCount).toBe(1);
    const videoId = initRes.body.videoId as string;

    // metadata reflects the draft status (no bytes through the API)
    const draftMeta = await request(app.getHttpServer())
      .get(`/videos/${videoId}`)
      .expect(200);
    expect(draftMeta.body.status).toBe('draft');

    // 2. presigned URL for part 1
    const urlRes = await request(app.getHttpServer())
      .get(`/videos/${videoId}/upload-url`)
      .query({ partNumber: 1 })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(urlRes.body.url).toContain('http');

    // 3. client PUTs the bytes directly to storage (never through the API)
    const putRes = await fetch(urlRes.body.url as string, {
      method: 'PUT',
      body: Buffer.from('hello-streamtube'),
    });
    expect(putRes.ok).toBe(true);
    const etag = putRes.headers.get('etag');
    expect(etag).toBeTruthy();

    // 4. complete: transitions to processing and enqueues the job
    const completeRes = await request(app.getHttpServer())
      .post(`/videos/${videoId}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ parts: [{ partNumber: 1, etag }] })
      .expect(200);
    expect(completeRes.body.videoId).toBe(videoId);
    expect(completeRes.body.status).toBe('processing');

    const processingMeta = await request(app.getHttpServer())
      .get(`/videos/${videoId}`)
      .expect(200);
    expect(processingMeta.body.status).toBe('processing');
  }, 30000);

  it('returns 403 when a non-owner requests an upload URL', async () => {
    const ownerToken = await registerConfirmAndLogin('owner@example.com');
    const otherToken = await registerConfirmAndLogin('intruder@example.com');

    const initRes = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(initBody)
      .expect(201);
    const videoId = initRes.body.videoId as string;

    const res = await request(app.getHttpServer())
      .get(`/videos/${videoId}/upload-url`)
      .query({ partNumber: 1 })
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    expect(res.body.error).toBe('VIDEO_FORBIDDEN');
  }, 30000);

  it('returns 400 when the requested size exceeds the maximum', async () => {
    const accessToken = await registerConfirmAndLogin('toobig@example.com');

    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...initBody, size: 10737418240 + 1 })
      .expect(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  }, 30000);
});
