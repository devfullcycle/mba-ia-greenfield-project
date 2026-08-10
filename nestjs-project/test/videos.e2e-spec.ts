import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
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
    videoRepository = dataSource.getRepository(Video);
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

  let userCounter = 0;
  async function registerConfirmAndLogin(): Promise<string> {
    const email = `video_e2e_${++userCounter}@example.com`;
    const password = 'password123';

    const authService = app.get(AuthService);
    const mailServiceInstance = (
      authService as unknown as {
        mailService: { sendConfirmationEmail: (...args: string[]) => void };
      }
    ).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce((_e: string, _n: string, t: string) => {
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
    return (res.body as { access_token: string }).access_token;
  }

  async function initiateUpload(
    accessToken: string,
    sizeBytes = 1000,
  ): Promise<{ id: string; uploadId: string; key: string; status: string }> {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ filename: 'movie.mp4', mimeType: 'video/mp4', sizeBytes })
      .expect(201);
    return res.body as {
      id: string;
      uploadId: string;
      key: string;
      status: string;
    };
  }

  describe('POST /videos', () => {
    it('returns 201 with { id, uploadId, key, status } and persists a draft row', async () => {
      const accessToken = await registerConfirmAndLogin();

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          filename: 'movie.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 1000,
        })
        .expect(201);

      const body = res.body as {
        id: string;
        uploadId: string;
        key: string;
        status: string;
      };
      expect(body.id).toBeDefined();
      expect(body.uploadId).toBeDefined();
      expect(body.key).toMatch(/^videos\/.+\/.+\/original\.mp4$/);
      expect(body.status).toBe('draft');

      const persisted = await videoRepository.findOneBy({
        slug: body.id,
      });
      expect(persisted?.status).toBe('draft');
      expect(persisted?.original_key).toBe(body.key);
    });

    it('returns 400 with FILE_TOO_LARGE when sizeBytes exceeds 10GB', async () => {
      const accessToken = await registerConfirmAndLogin();

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          filename: 'movie.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 10 * 1024 * 1024 * 1024 + 1,
        })
        .expect(400);

      expect((res.body as { error: string }).error).toBe('FILE_TOO_LARGE');
    });

    it('returns 401 without an Authorization header', async () => {
      await request(app.getHttpServer())
        .post('/videos')
        .send({ filename: 'movie.mp4', mimeType: 'video/mp4', sizeBytes: 1000 })
        .expect(401);
    });
  });

  describe('POST /videos/:id/upload-part-urls', () => {
    it('returns 200 with a presigned URL for each requested part', async () => {
      const accessToken = await registerConfirmAndLogin();
      const video = await initiateUpload(accessToken);

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/upload-part-urls`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ partNumbers: [1, 2] })
        .expect(200);

      const urlsBody = res.body as {
        urls: Array<{ partNumber: number; url: string }>;
      };
      expect(urlsBody.urls).toHaveLength(2);
      expect(urlsBody.urls[0]).toEqual({
        partNumber: 1,
        url: expect.any(String) as unknown as string,
      });
    });

    it("returns 403 with VIDEO_NOT_OWNED for another channel's video", async () => {
      const ownerToken = await registerConfirmAndLogin();
      const otherToken = await registerConfirmAndLogin();
      const video = await initiateUpload(ownerToken);

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/upload-part-urls`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ partNumbers: [1] })
        .expect(403);

      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_OWNED');
    });

    it("returns 409 with INVALID_VIDEO_STATUS when the video is not 'draft'", async () => {
      const accessToken = await registerConfirmAndLogin();
      const video = await initiateUpload(accessToken);
      await videoRepository.update(
        { slug: video.id },
        { status: 'processing', upload_id: null },
      );

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/upload-part-urls`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ partNumbers: [1] })
        .expect(409);

      expect((res.body as { error: string }).error).toBe(
        'INVALID_VIDEO_STATUS',
      );
    });
  });

  describe('POST /videos/:id/complete-upload', () => {
    it('returns 200 with status processing and enqueues a fetchable job', async () => {
      const accessToken = await registerConfirmAndLogin();
      const video = await initiateUpload(accessToken);
      const partUrlsRes = await request(app.getHttpServer())
        .post(`/videos/${video.id}/upload-part-urls`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ partNumbers: [1] })
        .expect(200);
      const partUrlsBody = partUrlsRes.body as {
        urls: Array<{ partNumber: number; url: string }>;
      };
      const uploadResponse = await fetch(partUrlsBody.urls[0].url, {
        method: 'PUT',
        body: new Uint8Array(Buffer.from('hello from the e2e test')),
      });
      const eTag = uploadResponse.headers.get('etag')!;

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/complete-upload`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ partNumber: 1, eTag }] })
        .expect(200);

      expect(res.body).toEqual({ id: video.id, status: 'processing' });
      const persisted = await videoRepository.findOneBy({ slug: video.id });
      expect(persisted?.status).toBe('processing');
    });

    it("returns 409 with INVALID_VIDEO_STATUS when the video is not 'draft'", async () => {
      const accessToken = await registerConfirmAndLogin();
      const video = await initiateUpload(accessToken);
      await videoRepository.update(
        { slug: video.id },
        { status: 'ready', upload_id: null },
      );

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/complete-upload`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ partNumber: 1, eTag: 'bogus' }] })
        .expect(409);

      expect((res.body as { error: string }).error).toBe(
        'INVALID_VIDEO_STATUS',
      );
    });
  });

  describe('GET /videos/:id', () => {
    it('returns 200 with metadata for the owning channel', async () => {
      const accessToken = await registerConfirmAndLogin();
      const video = await initiateUpload(accessToken);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toEqual({
        id: video.id,
        status: 'draft',
        title: 'movie',
        originalFilename: 'movie.mp4',
        mimeType: 'video/mp4',
        sizeBytes: '1000',
        durationSeconds: null,
        metadata: null,
        createdAt: expect.any(String) as unknown as string,
        updatedAt: expect.any(String) as unknown as string,
      });
    });

    it("returns 403 with VIDEO_NOT_OWNED for another channel's video", async () => {
      const ownerToken = await registerConfirmAndLogin();
      const otherToken = await registerConfirmAndLogin();
      const video = await initiateUpload(ownerToken);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);

      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_OWNED');
    });

    it('returns 404 with VIDEO_NOT_FOUND for a non-existent id', async () => {
      const accessToken = await registerConfirmAndLogin();

      const res = await request(app.getHttpServer())
        .get('/videos/no-such-video')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /videos/:id/stream', () => {
    it('returns 302 redirecting to a presigned inline URL when ready', async () => {
      const accessToken = await registerConfirmAndLogin();
      const video = await initiateUpload(accessToken);
      await videoRepository.update({ slug: video.id }, { status: 'ready' });

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.id}/stream`)
        .set('Authorization', `Bearer ${accessToken}`)
        .redirects(0)
        .expect(302);

      expect(res.headers.location).toEqual(expect.stringContaining('http'));
    });

    it('returns 409 with INVALID_VIDEO_STATUS when the video is not ready', async () => {
      const accessToken = await registerConfirmAndLogin();
      const video = await initiateUpload(accessToken);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.id}/stream`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);

      expect((res.body as { error: string }).error).toBe(
        'INVALID_VIDEO_STATUS',
      );
    });
  });

  describe('GET /videos/:id/download', () => {
    it('returns 302 redirecting to a presigned attachment URL when ready', async () => {
      const accessToken = await registerConfirmAndLogin();
      const video = await initiateUpload(accessToken);
      await videoRepository.update({ slug: video.id }, { status: 'ready' });

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.id}/download`)
        .set('Authorization', `Bearer ${accessToken}`)
        .redirects(0)
        .expect(302);

      expect(res.headers.location).toEqual(expect.stringContaining('http'));
    });

    it('returns 409 with INVALID_VIDEO_STATUS when the video is not ready', async () => {
      const accessToken = await registerConfirmAndLogin();
      const video = await initiateUpload(accessToken);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.id}/download`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);

      expect((res.body as { error: string }).error).toBe(
        'INVALID_VIDEO_STATUS',
      );
    });
  });

  describe('POST /videos/:id/reprocess', () => {
    it('returns 200 with status processing and clears the failure reason', async () => {
      const accessToken = await registerConfirmAndLogin();
      const video = await initiateUpload(accessToken);
      await videoRepository.update(
        { slug: video.id },
        { status: 'failed', failure_reason: 'ffmpeg crashed' },
      );

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/reprocess`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toEqual({ id: video.id, status: 'processing' });
      const persisted = await videoRepository.findOneBy({ slug: video.id });
      expect(persisted?.status).toBe('processing');
      expect(persisted?.failure_reason).toBeNull();
    });

    it("returns 403 with VIDEO_NOT_OWNED for another channel's video", async () => {
      const ownerToken = await registerConfirmAndLogin();
      const otherToken = await registerConfirmAndLogin();
      const video = await initiateUpload(ownerToken);
      await videoRepository.update({ slug: video.id }, { status: 'failed' });

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/reprocess`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);

      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_OWNED');
    });

    it('returns 409 with INVALID_VIDEO_STATUS when the video is not failed', async () => {
      const accessToken = await registerConfirmAndLogin();
      const video = await initiateUpload(accessToken);

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/reprocess`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);

      expect((res.body as { error: string }).error).toBe(
        'INVALID_VIDEO_STATUS',
      );
    });
  });
});
