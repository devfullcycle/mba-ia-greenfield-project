import * as fs from 'fs';
import * as path from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { Video } from '../src/videos/entities/video.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

const SAMPLE_FIXTURE_PATH = path.join(__dirname, 'fixtures/sample.mp4');

interface AuthResponseBody {
  access_token: string;
  refresh_token: string;
}

interface VideoResponseBody {
  id: string;
  status: string;
  uploadId: string;
  parts: { partNumber: number; url: string }[];
}

interface VideoPlaybackResponseBody {
  id: string;
  status: string;
  durationSeconds: number | null;
  streamUrl?: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  failureReason?: string;
}

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
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  let counter = 0;
  async function registerConfirmAndLogin(): Promise<string> {
    const email = `videos_e2e_${++counter}@example.com`;
    const password = 'password123';

    const mailService = app.get(MailService);
    let capturedToken = '';
    jest
      .spyOn(mailService, 'sendConfirmationEmail')
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
    return (res.body as AuthResponseBody).access_token;
  }

  const validBody = {
    originalFilename: 'movie.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 1024,
  };

  describe('POST /videos', () => {
    it('returns 201 with { id, status, uploadId, parts } and a Location header for a valid request', async () => {
      const accessToken = await registerConfirmAndLogin();

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validBody)
        .expect(201);

      const body = res.body as VideoResponseBody;
      expect(typeof body.id).toBe('string');
      expect(body.status).toBe('draft');
      expect(typeof body.uploadId).toBe('string');
      expect(body.parts[0].partNumber).toBe(1);
      expect(typeof body.parts[0].url).toBe('string');
      expect(res.headers.location).toBe(`/videos/${body.id}`);
    });

    it('returns 401 without an Authorization header', async () => {
      await request(app.getHttpServer())
        .post('/videos')
        .send(validBody)
        .expect(401);
    });

    it('returns 400 when sizeBytes exceeds 10GB', async () => {
      const accessToken = await registerConfirmAndLogin();

      await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...validBody, sizeBytes: 10 * 1024 * 1024 * 1024 + 1 })
        .expect(400);
    });

    it('returns 400 when mimeType does not match video/*', async () => {
      const accessToken = await registerConfirmAndLogin();

      await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...validBody, mimeType: 'image/png' })
        .expect(400);
    });
  });

  describe('POST /videos/:id/complete-upload', () => {
    async function createDraftAndUploadPart(
      accessToken: string,
    ): Promise<{ id: string; eTag: string }> {
      const createRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validBody)
        .expect(201);
      const body = createRes.body as VideoResponseBody;

      const uploadResponse = await fetch(body.parts[0].url, {
        method: 'PUT',
        body: Buffer.from('e2e test bytes'),
      });
      const eTag = uploadResponse.headers.get('etag')!;

      return { id: body.id, eTag };
    }

    it('returns 200 with { id, status: processing } for a valid completion by the owner', async () => {
      const accessToken = await registerConfirmAndLogin();
      const { id, eTag } = await createDraftAndUploadPart(accessToken);

      const res = await request(app.getHttpServer())
        .post(`/videos/${id}/complete-upload`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ partNumber: 1, eTag }] })
        .expect(200);

      expect(res.body).toEqual({ id, status: 'processing' });
    });

    it('returns 401 without an Authorization header', async () => {
      await request(app.getHttpServer())
        .post('/videos/00000000-0000-0000-0000-000000000000/complete-upload')
        .send({ parts: [{ partNumber: 1, eTag: 'x' }] })
        .expect(401);
    });

    it('returns 404 for an unknown video id', async () => {
      const accessToken = await registerConfirmAndLogin();

      await request(app.getHttpServer())
        .post('/videos/00000000-0000-0000-0000-000000000000/complete-upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ partNumber: 1, eTag: 'x' }] })
        .expect(404);
    });

    it('returns 403 when a different channel attempts to complete the upload', async () => {
      const ownerToken = await registerConfirmAndLogin();
      const { id } = await createDraftAndUploadPart(ownerToken);
      const otherToken = await registerConfirmAndLogin();

      await request(app.getHttpServer())
        .post(`/videos/${id}/complete-upload`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ parts: [{ partNumber: 1, eTag: 'x' }] })
        .expect(403);
    });

    it('returns 409 when the video was already completed', async () => {
      const accessToken = await registerConfirmAndLogin();
      const { id, eTag } = await createDraftAndUploadPart(accessToken);
      await request(app.getHttpServer())
        .post(`/videos/${id}/complete-upload`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ partNumber: 1, eTag }] })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/videos/${id}/complete-upload`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ partNumber: 1, eTag }] })
        .expect(409);
    });
  });

  describe('GET /videos/:id', () => {
    it('returns 200 with status draft and no media URLs before the upload completes, without an Authorization header', async () => {
      const accessToken = await registerConfirmAndLogin();
      const createRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validBody)
        .expect(201);
      const { id } = createRes.body as VideoResponseBody;

      const res = await request(app.getHttpServer())
        .get(`/videos/${id}`)
        .expect(200);

      const body = res.body as VideoPlaybackResponseBody;
      expect(body.status).toBe('draft');
      expect(body.streamUrl).toBeUndefined();
      expect(body.downloadUrl).toBeUndefined();
      expect(body.thumbnailUrl).toBeUndefined();
    });

    it('returns 404 for an unknown video id', async () => {
      await request(app.getHttpServer())
        .get('/videos/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('returns streamUrl, downloadUrl, and thumbnailUrl once the video is ready', async () => {
      const accessToken = await registerConfirmAndLogin();
      const createRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validBody)
        .expect(201);
      const { id } = createRes.body as VideoResponseBody;

      const videoRepository = dataSource.getRepository(Video);
      await videoRepository.update(
        { id },
        {
          status: 'ready',
          duration_seconds: 42.5,
          thumbnail_key: `videos/${id}/thumbnail.jpg`,
        },
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${id}`)
        .expect(200);

      const body = res.body as VideoPlaybackResponseBody;
      expect(body.status).toBe('ready');
      expect(body.durationSeconds).toBe(42.5);
      expect(typeof body.streamUrl).toBe('string');
      expect(typeof body.downloadUrl).toBe('string');
      expect(typeof body.thumbnailUrl).toBe('string');
    });

    it('returns failureReason and no media URLs for a failed video', async () => {
      const accessToken = await registerConfirmAndLogin();
      const createRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validBody)
        .expect(201);
      const { id } = createRes.body as VideoResponseBody;

      const videoRepository = dataSource.getRepository(Video);
      await videoRepository.update(
        { id },
        { status: 'failed', failure_reason: 'Unsupported codec' },
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${id}`)
        .expect(200);

      const body = res.body as VideoPlaybackResponseBody;
      expect(body.status).toBe('failed');
      expect(body.failureReason).toBe('Unsupported codec');
      expect(body.streamUrl).toBeUndefined();
    });
  });

  describe('Full upload → process → ready flow', () => {
    async function pollUntilReady(
      id: string,
      timeoutMs: number,
    ): Promise<VideoPlaybackResponseBody> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const res = await request(app.getHttpServer()).get(`/videos/${id}`);
        const body = res.body as VideoPlaybackResponseBody;
        if (body.status === 'ready' || body.status === 'failed') {
          return body;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error(
        `Timed out waiting for video ${id} to leave 'processing' status`,
      );
    }

    it('processes a real video fixture end to end via the running video-worker', async () => {
      const accessToken = await registerConfirmAndLogin();
      const fixtureBuffer = fs.readFileSync(SAMPLE_FIXTURE_PATH);

      const createRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalFilename: 'sample.mp4',
          mimeType: 'video/mp4',
          sizeBytes: fixtureBuffer.length,
        })
        .expect(201);
      const created = createRes.body as VideoResponseBody;
      expect(created.parts).toHaveLength(1);

      const uploadResponse = await fetch(created.parts[0].url, {
        method: 'PUT',
        body: fixtureBuffer,
      });
      expect(uploadResponse.status).toBe(200);
      const eTag = uploadResponse.headers.get('etag')!;

      await request(app.getHttpServer())
        .post(`/videos/${created.id}/complete-upload`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ partNumber: 1, eTag }] })
        .expect(200);

      const finalState = await pollUntilReady(created.id, 30000);

      expect(finalState.status).toBe('ready');
      expect(finalState.durationSeconds).toBeGreaterThan(0);
      expect(typeof finalState.streamUrl).toBe('string');
      expect(typeof finalState.thumbnailUrl).toBe('string');

      const streamResponse = await fetch(finalState.streamUrl!);
      expect(streamResponse.status).toBe(200);
      const thumbnailResponse = await fetch(finalState.thumbnailUrl!);
      expect(thumbnailResponse.status).toBe(200);
      expect(thumbnailResponse.headers.get('content-type')).toBe('image/jpeg');
    }, 40000);
  });
});
