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
import { StorageService } from '../src/storage/storage.service';
import storageConfig from '../src/config/storage.config';

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storageService: StorageService;
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
    storageService = moduleFixture.get(StorageService);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function registerConfirmAndLogin(
    email: string,
    password = 'password123',
  ): Promise<string> {
    const authService = app.get(AuthService);
    const mailServiceInstance = (authService as any).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) => {
        capturedToken = t;
      });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return res.body.access_token;
  }

  describe('full upload -> process -> stream -> download lifecycle', () => {
    it('walks the video through its whole HTTP lifecycle', async () => {
      const accessToken = await registerConfirmAndLogin(
        'lifecycle@example.com',
      );

      const initRes = await request(app.getHttpServer())
        .post('/videos/upload-init')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'My Video', originalFilename: 'clip.mp4' })
        .expect(201);

      expect(initRes.body.videoId).toBeDefined();
      expect(initRes.body.urlCode).toBeDefined();
      expect(initRes.body.uploadUrl).toContain(initRes.body.storageKey);

      await storageService.uploadBuffer(
        storageConfig().bucketVideos,
        initRes.body.storageKey,
        Buffer.from('fake-mp4-bytes'),
        'video/mp4',
      );

      const completeRes = await request(app.getHttpServer())
        .post(`/videos/${initRes.body.urlCode}/upload-complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(completeRes.body.status).toBe('processing');

      const statusRes = await request(app.getHttpServer())
        .get(`/videos/${initRes.body.urlCode}`)
        .expect(200);

      expect(statusRes.body.title).toBe('My Video');
      expect(['processing', 'ready']).toContain(statusRes.body.status);

      const streamRes = await request(app.getHttpServer())
        .get(`/videos/${initRes.body.urlCode}/stream`)
        .set('Range', 'bytes=0-4')
        .expect(206);

      expect(streamRes.headers['content-range']).toBeDefined();
      expect(streamRes.headers['accept-ranges']).toBe('bytes');

      const downloadRes = await request(app.getHttpServer())
        .get(`/videos/${initRes.body.urlCode}/download`)
        .expect(302);

      expect(downloadRes.headers.location).toContain(initRes.body.storageKey);
    }, 30000);
  });

  describe('POST /videos/upload-init', () => {
    it('returns 401 without an access token', async () => {
      await request(app.getHttpServer())
        .post('/videos/upload-init')
        .send({ title: 'Video', originalFilename: 'clip.mp4' })
        .expect(401);
    });

    it('returns 400 with VALIDATION_ERROR on missing title', async () => {
      const accessToken = await registerConfirmAndLogin('badinit@example.com');

      const res = await request(app.getHttpServer())
        .post('/videos/upload-init')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ originalFilename: 'clip.mp4' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /videos/:urlCode/upload-complete', () => {
    it('returns 403 with VIDEO_ACCESS_DENIED when another user owns the video', async () => {
      const ownerToken = await registerConfirmAndLogin('owner@example.com');
      const otherToken = await registerConfirmAndLogin('other@example.com');

      const initRes = await request(app.getHttpServer())
        .post('/videos/upload-init')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Video', originalFilename: 'clip.mp4' });

      await storageService.uploadBuffer(
        storageConfig().bucketVideos,
        initRes.body.storageKey,
        Buffer.from('fake-mp4-bytes'),
        'video/mp4',
      );

      const res = await request(app.getHttpServer())
        .post(`/videos/${initRes.body.urlCode}/upload-complete`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);

      expect(res.body.error).toBe('VIDEO_ACCESS_DENIED');
    });

    it('returns 400 with STORAGE_UPLOAD_FAILED when the file was never uploaded', async () => {
      const accessToken = await registerConfirmAndLogin('nofile@example.com');

      const initRes = await request(app.getHttpServer())
        .post('/videos/upload-init')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Video', originalFilename: 'clip.mp4' });

      const res = await request(app.getHttpServer())
        .post(`/videos/${initRes.body.urlCode}/upload-complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      expect(res.body.error).toBe('STORAGE_UPLOAD_FAILED');
    });
  });

  describe('GET /videos/:urlCode', () => {
    it('returns 404 with VIDEO_NOT_FOUND for an unknown urlCode', async () => {
      const res = await request(app.getHttpServer())
        .get('/videos/doesnotexist')
        .expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /videos/:urlCode/stream', () => {
    it('returns 422 with VIDEO_NOT_READY for a draft video', async () => {
      const accessToken = await registerConfirmAndLogin(
        'draftstream@example.com',
      );

      const initRes = await request(app.getHttpServer())
        .post('/videos/upload-init')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Video', originalFilename: 'clip.mp4' });

      const res = await request(app.getHttpServer())
        .get(`/videos/${initRes.body.urlCode}/stream`)
        .expect(422);

      expect(res.body.error).toBe('VIDEO_NOT_READY');
    });
  });
});
