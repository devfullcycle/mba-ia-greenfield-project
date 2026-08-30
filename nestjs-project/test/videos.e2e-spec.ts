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
import { Video, VideoStatus } from '../src/videos/entities/video.entity';

describe('Videos (e2e)', () => {
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
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  let counter = 0;
  async function registerConfirmAndLogin(): Promise<string> {
    counter += 1;
    const email = `videos_e2e_${counter}@example.com`;
    const password = 'password123';

    const authService = app.get(AuthService);
    const mailServiceInstance = (authService as any).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce((_e: string, _n: string, t: string) => {
        capturedToken = t;
        return Promise.resolve();
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

  describe('POST /videos', () => {
    it('returns 201 with id, upload_id, and parts for a valid request', async () => {
      const token = await registerConfirmAndLogin();

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          original_filename: 'video.mp4',
          content_type: 'video/mp4',
          size_bytes: 15 * 1024 * 1024,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toHaveLength(12);
      expect(res.body.upload_id).toBeTruthy();
      expect(res.body.parts).toHaveLength(2);
    }, 30000);

    it('returns 400 FILE_TOO_LARGE when size_bytes exceeds 10GB', async () => {
      const token = await registerConfirmAndLogin();

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          original_filename: 'video.mp4',
          content_type: 'video/mp4',
          size_bytes: 10 * 1024 * 1024 * 1024 + 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('FILE_TOO_LARGE');
    }, 30000);

    it('returns 401 without an Authorization header', async () => {
      const res = await request(app.getHttpServer()).post('/videos').send({
        original_filename: 'video.mp4',
        content_type: 'video/mp4',
        size_bytes: 1024,
      });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /videos/:publicId/complete', () => {
    async function initiateUpload(
      token: string,
      sizeBytes = 1024,
    ): Promise<{ id: string; parts: { part_number: number; url: string }[] }> {
      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          original_filename: 'video.mp4',
          content_type: 'video/mp4',
          size_bytes: sizeBytes,
        });
      return res.body;
    }

    it('returns 200 with status processando for a valid completion', async () => {
      const token = await registerConfirmAndLogin();
      const initiated = await initiateUpload(token);
      const putResponse = await fetch(initiated.parts[0].url, {
        method: 'PUT',
        body: 'a'.repeat(1024),
      });
      const etag = putResponse.headers.get('etag')!;

      const res = await request(app.getHttpServer())
        .post(`/videos/${initiated.id}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parts: [{ part_number: 1, etag }] });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('processando');
    }, 30000);

    it('returns 404 VIDEO_NOT_FOUND for an unknown publicId', async () => {
      const token = await registerConfirmAndLogin();

      const res = await request(app.getHttpServer())
        .post('/videos/doesnotexist/complete')
        .set('Authorization', `Bearer ${token}`)
        .send({ parts: [{ part_number: 1, etag: 'x' }] });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('returns 403 FORBIDDEN when the caller does not own the video', async () => {
      const ownerToken = await registerConfirmAndLogin();
      const initiated = await initiateUpload(ownerToken);
      const otherToken = await registerConfirmAndLogin();

      const res = await request(app.getHttpServer())
        .post(`/videos/${initiated.id}/complete`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ parts: [{ part_number: 1, etag: 'x' }] });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    }, 30000);

    it('returns 409 UPLOAD_ALREADY_COMPLETED when completing twice', async () => {
      const token = await registerConfirmAndLogin();
      const initiated = await initiateUpload(token);
      const putResponse = await fetch(initiated.parts[0].url, {
        method: 'PUT',
        body: 'a'.repeat(1024),
      });
      const etag = putResponse.headers.get('etag')!;
      const parts = [{ part_number: 1, etag }];

      await request(app.getHttpServer())
        .post(`/videos/${initiated.id}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parts });

      const res = await request(app.getHttpServer())
        .post(`/videos/${initiated.id}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parts });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('UPLOAD_ALREADY_COMPLETED');
    }, 30000);
  });

  describe('DELETE /videos/:publicId', () => {
    async function initiateUpload(
      token: string,
    ): Promise<{ id: string; parts: { part_number: number; url: string }[] }> {
      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          original_filename: 'video.mp4',
          content_type: 'video/mp4',
          size_bytes: 1024,
        });
      return res.body;
    }

    it('returns 204 and removes the video row on a rascunho video', async () => {
      const token = await registerConfirmAndLogin();
      const initiated = await initiateUpload(token);

      const res = await request(app.getHttpServer())
        .delete(`/videos/${initiated.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(204);

      const saved = await dataSource
        .getRepository(Video)
        .findOne({ where: { public_id: initiated.id } });
      expect(saved).toBeNull();
    }, 30000);

    it('returns 404 VIDEO_NOT_FOUND for an unknown publicId', async () => {
      const token = await registerConfirmAndLogin();

      const res = await request(app.getHttpServer())
        .delete('/videos/doesnotexist')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('returns 403 FORBIDDEN when the caller does not own the video', async () => {
      const ownerToken = await registerConfirmAndLogin();
      const initiated = await initiateUpload(ownerToken);
      const otherToken = await registerConfirmAndLogin();

      const res = await request(app.getHttpServer())
        .delete(`/videos/${initiated.id}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    }, 30000);

    it('returns 409 INVALID_UPLOAD_STATE when the video is already processando', async () => {
      const token = await registerConfirmAndLogin();
      const initiated = await initiateUpload(token);
      const putResponse = await fetch(initiated.parts[0].url, {
        method: 'PUT',
        body: 'a'.repeat(1024),
      });
      const etag = putResponse.headers.get('etag')!;
      await request(app.getHttpServer())
        .post(`/videos/${initiated.id}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parts: [{ part_number: 1, etag }] });

      const res = await request(app.getHttpServer())
        .delete(`/videos/${initiated.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('INVALID_UPLOAD_STATE');
    }, 30000);
  });

  describe('GET /videos/:publicId', () => {
    async function initiateUpload(token: string): Promise<{ id: string }> {
      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          original_filename: 'video.mp4',
          content_type: 'video/mp4',
          size_bytes: 1024,
        });
      return res.body;
    }

    it('returns 404 for a rascunho video requested anonymously', async () => {
      const token = await registerConfirmAndLogin();
      const initiated = await initiateUpload(token);

      const res = await request(app.getHttpServer()).get(
        `/videos/${initiated.id}`,
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    }, 30000);

    it('returns 200 for the owner regardless of status', async () => {
      const token = await registerConfirmAndLogin();
      const initiated = await initiateUpload(token);

      const res = await request(app.getHttpServer())
        .get(`/videos/${initiated.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('rascunho');
    }, 30000);

    it('returns 200 for a pronto video requested anonymously', async () => {
      const token = await registerConfirmAndLogin();
      const initiated = await initiateUpload(token);
      await dataSource
        .getRepository(Video)
        .update({ public_id: initiated.id }, { status: VideoStatus.PRONTO });

      const res = await request(app.getHttpServer()).get(
        `/videos/${initiated.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('pronto');
    }, 30000);

    it('returns 404 for an unknown publicId', async () => {
      const res = await request(app.getHttpServer()).get(
        '/videos/doesnotexist',
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /videos/:publicId/stream and /download', () => {
    async function initiateUpload(token: string): Promise<{ id: string }> {
      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          original_filename: 'video.mp4',
          content_type: 'video/mp4',
          size_bytes: 1024,
        });
      return res.body;
    }

    async function makeProntoVideo(token: string): Promise<string> {
      const initiated = await initiateUpload(token);
      await dataSource
        .getRepository(Video)
        .update({ public_id: initiated.id }, { status: VideoStatus.PRONTO });
      return initiated.id;
    }

    it('GET .../stream returns 302 with a Location header when pronto', async () => {
      const token = await registerConfirmAndLogin();
      const publicId = await makeProntoVideo(token);

      const res = await request(app.getHttpServer()).get(
        `/videos/${publicId}/stream`,
      );

      expect(res.status).toBe(302);
      expect(res.headers.location).toBeTruthy();
    }, 30000);

    it('GET .../stream returns 409 VIDEO_NOT_READY when not pronto', async () => {
      const token = await registerConfirmAndLogin();
      const initiated = await initiateUpload(token);

      const res = await request(app.getHttpServer())
        .get(`/videos/${initiated.id}/stream`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('VIDEO_NOT_READY');
    }, 30000);

    it('GET .../download returns 302 with an attachment-disposition URL when pronto', async () => {
      const token = await registerConfirmAndLogin();
      const publicId = await makeProntoVideo(token);

      const res = await request(app.getHttpServer()).get(
        `/videos/${publicId}/download`,
      );

      expect(res.status).toBe(302);
      expect(decodeURIComponent(res.headers.location)).toContain('attachment');
    }, 30000);

    it('both endpoints return 404 VIDEO_NOT_FOUND for an unknown publicId', async () => {
      const streamRes = await request(app.getHttpServer()).get(
        '/videos/doesnotexist/stream',
      );
      const downloadRes = await request(app.getHttpServer()).get(
        '/videos/doesnotexist/download',
      );

      expect(streamRes.status).toBe(404);
      expect(streamRes.body.error).toBe('VIDEO_NOT_FOUND');
      expect(downloadRes.status).toBe(404);
      expect(downloadRes.body.error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('Rate limiting', () => {
    it('is not subject to the global 10 req/min auth throttle (status polling use case)', async () => {
      // The global ThrottlerGuard is registered via APP_GUARD in AuthModule,
      // which makes it apply to every route in the app, not just /auth/* —
      // VideosController must opt out via @SkipThrottle() so a client can
      // poll GET /videos/:publicId for processing status without being
      // rate-limited after 10 requests/min.
      const token = await registerConfirmAndLogin();
      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          original_filename: 'video.mp4',
          content_type: 'video/mp4',
          size_bytes: 1024,
        });
      const publicId = res.body.id;

      for (let i = 0; i < 15; i++) {
        const pollRes = await request(app.getHttpServer())
          .get(`/videos/${publicId}`)
          .set('Authorization', `Bearer ${token}`);
        expect(pollRes.status).not.toBe(429);
      }
    }, 30000);
  });
});
