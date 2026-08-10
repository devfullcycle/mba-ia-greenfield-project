import * as crypto from 'crypto';
import { Readable } from 'stream';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { StorageService } from '../src/storage/storage.service';
import { VIDEO_QUEUE_NAME, VideoStatus } from '../src/videos/videos.constants';
import { cleanAllTables } from '../src/test/create-test-data-source';

const mockStorage = {
  generatePresignedPutUrl: jest
    .fn()
    .mockResolvedValue(
      'http://minio:9000/streamtube/videos/test/original.mp4?X-Amz-Signature=fake',
    ),
  getObject: jest.fn().mockResolvedValue({
    stream: Readable.from(['fake video data']),
    contentType: 'video/mp4',
    contentLength: 15,
    contentRange: undefined,
  }),
  putObject: jest.fn().mockResolvedValue(undefined),
  deleteObject: jest.fn().mockResolvedValue(undefined),
  getBucketName: jest.fn().mockReturnValue('streamtube'),
  onModuleInit: jest.fn().mockResolvedValue(undefined),
};

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue(mockStorage)
      .compile();

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
    moduleFixture.get(getQueueToken(VIDEO_QUEUE_NAME)).on('error', () => {});
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
    jest.clearAllMocks();
    mockStorage.generatePresignedPutUrl.mockResolvedValue(
      'http://minio:9000/streamtube/videos/test/original.mp4?X-Amz-Signature=fake',
    );
    mockStorage.getObject.mockResolvedValue({
      stream: Readable.from(['fake video data']),
      contentType: 'video/mp4',
      contentLength: 15,
      contentRange: undefined,
    });
    mockStorage.getBucketName.mockReturnValue('streamtube');
  });

  async function captureConfirmationToken(
    email: string,
    password = 'password123',
  ): Promise<string> {
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
    return capturedToken;
  }

  async function registerConfirmAndLogin(
    email: string,
    password = 'password123',
  ): Promise<{ access_token: string; refresh_token: string }> {
    const token = await captureConfirmationToken(email, password);
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return {
      access_token: res.body.access_token,
      refresh_token: res.body.refresh_token,
    };
  }

  async function getChannelId(userId: string): Promise<string> {
    const row = await dataSource.query(
      'SELECT id FROM channels WHERE user_id = $1',
      [userId],
    );
    return row[0].id as string;
  }

  function getUserIdFromToken(token: string): string {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString(),
    ) as { sub: string };
    return payload.sub;
  }

  async function insertReadyVideo(channelId: string): Promise<string> {
    const videoId = crypto.randomUUID();
    await dataSource.query(
      `INSERT INTO videos (id, title, status, channel_id, storage_key, created_at, updated_at)
       VALUES ($1, 'Test Video', 'ready', $2, $3, NOW(), NOW())`,
      [videoId, channelId, `videos/${videoId}/original.mp4`],
    );
    return videoId;
  }

  // ─── T053: Golden path ──────────────────────────────────────────────────────

  describe('Golden path (T053)', () => {
    it('POST /videos → status draft with upload_url and storage_key', async () => {
      const { access_token } =
        await registerConfirmAndLogin('golden@example.com');

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'My First Video',
          file_size: 1024 * 1024,
          mime_type: 'video/mp4',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe(VideoStatus.DRAFT);
      expect(res.body.upload_url).toBeDefined();
      expect(res.body.storage_key).toMatch(/^videos\/.+\/original\.mp4$/);
    });

    it('storage_key matches pattern videos/{uuid}/original.{ext}', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'golden2@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({ title: 'Test', file_size: 500, mime_type: 'video/webm' })
        .expect(201);

      expect(res.body.storage_key).toMatch(
        /^videos\/[0-9a-f-]{36}\/original\.webm$/,
      );
    });

    it('two videos with same title receive distinct UUIDs (US5)', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'golden3@example.com',
      );

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post('/videos')
          .set('Authorization', `Bearer ${access_token}`)
          .send({
            title: 'Duplicate Title',
            file_size: 1024,
            mime_type: 'video/mp4',
          }),
        request(app.getHttpServer())
          .post('/videos')
          .set('Authorization', `Bearer ${access_token}`)
          .send({
            title: 'Duplicate Title',
            file_size: 1024,
            mime_type: 'video/mp4',
          }),
      ]);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.id).not.toBe(res2.body.id);
    });

    it('POST /videos/:id/upload-complete → status processing', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'golden4@example.com',
      );

      const initRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({ title: 'Proc Video', file_size: 2048, mime_type: 'video/mp4' })
        .expect(201);

      const completeRes = await request(app.getHttpServer())
        .post(`/videos/${initRes.body.id}/upload-complete`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);

      expect(completeRes.body.status).toBe(VideoStatus.PROCESSING);
      expect(completeRes.body.id).toBe(initRes.body.id);
    });

    it('GET /videos/:id returns public metadata without errorCause', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'golden5@example.com',
      );
      const userId = getUserIdFromToken(access_token);
      const channelId = await getChannelId(userId);
      const videoId = await insertReadyVideo(channelId);

      const res = await request(app.getHttpServer())
        .get(`/videos/${videoId}`)
        .expect(200);

      expect(res.body.id).toBe(videoId);
      expect(res.body.status).toBe(VideoStatus.READY);
      expect(res.body.error_cause).toBeUndefined();
      expect(res.body.title).toBe('Test Video');
    });

    it('GET /videos/:id/stream returns 200 for ready video', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'golden6@example.com',
      );
      const userId = getUserIdFromToken(access_token);
      const channelId = await getChannelId(userId);
      const videoId = await insertReadyVideo(channelId);

      const res = await request(app.getHttpServer())
        .get(`/videos/${videoId}/stream`)
        .expect(200);

      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-type']).toContain('video/mp4');
    });

    it('GET /videos/:id/stream with Range header → 206 with Content-Range', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'golden6b@example.com',
      );
      const userId = getUserIdFromToken(access_token);
      const channelId = await getChannelId(userId);
      const videoId = await insertReadyVideo(channelId);

      mockStorage.getObject.mockResolvedValueOnce({
        stream: Readable.from(['fake video data']),
        contentType: 'video/mp4',
        contentLength: 15,
        contentRange: 'bytes 0-14/15',
      });

      const res = await request(app.getHttpServer())
        .get(`/videos/${videoId}/stream`)
        .set('Range', 'bytes=0-14')
        .expect(206);

      expect(res.headers['content-range']).toBe('bytes 0-14/15');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-type']).toContain('video/mp4');
    });

    it('GET /videos/:id/download → 200 with Content-Disposition attachment', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'golden7@example.com',
      );
      const userId = getUserIdFromToken(access_token);
      const channelId = await getChannelId(userId);
      const videoId = await insertReadyVideo(channelId);

      const res = await request(app.getHttpServer())
        .get(`/videos/${videoId}/download`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);

      expect(res.headers['content-disposition']).toContain('attachment');
    });

    it('GET /channels/:channelId/videos returns paginated list', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'golden8@example.com',
      );
      const userId = getUserIdFromToken(access_token);
      const channelId = await getChannelId(userId);
      await insertReadyVideo(channelId);

      const res = await request(app.getHttpServer())
        .get(`/channels/${channelId}/videos`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.has_next_page).toBe(false);
    });

    it('PATCH /videos/:id updates title, id remains unchanged', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'golden9@example.com',
      );
      const userId = getUserIdFromToken(access_token);
      const channelId = await getChannelId(userId);
      const videoId = await insertReadyVideo(channelId);

      const res = await request(app.getHttpServer())
        .patch(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ title: 'New Title' })
        .expect(200);

      expect(res.body.id).toBe(videoId);
      expect(res.body.title).toBe('New Title');
    });

    it('DELETE /videos/:id returns 204 and video no longer accessible', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'golden10@example.com',
      );
      const userId = getUserIdFromToken(access_token);
      const channelId = await getChannelId(userId);
      const videoId = await insertReadyVideo(channelId);

      await request(app.getHttpServer())
        .delete(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(204);

      await request(app.getHttpServer()).get(`/videos/${videoId}`).expect(404);
    });
  });

  // ─── T054: Authorization scenarios ─────────────────────────────────────────

  describe('Authorization scenarios (T054)', () => {
    it('POST /videos without token → 401', async () => {
      await request(app.getHttpServer())
        .post('/videos')
        .send({ title: 'Test', file_size: 1024, mime_type: 'video/mp4' })
        .expect(401);
    });

    it('POST /videos/:id/upload-complete with token of different user → 403', async () => {
      const { access_token: ownerToken } =
        await registerConfirmAndLogin('owner@example.com');
      const { access_token: otherToken } =
        await registerConfirmAndLogin('other@example.com');

      const initRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Owner Video', file_size: 1024, mime_type: 'video/mp4' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/videos/${initRes.body.id}/upload-complete`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('GET /videos/:id without token → 200 (public)', async () => {
      const { access_token } =
        await registerConfirmAndLogin('pub1@example.com');
      const userId = getUserIdFromToken(access_token);
      const channelId = await getChannelId(userId);
      const videoId = await insertReadyVideo(channelId);

      await request(app.getHttpServer()).get(`/videos/${videoId}`).expect(200);
    });

    it('GET /videos/:id/stream without token → 200 (public)', async () => {
      const { access_token } =
        await registerConfirmAndLogin('pub2@example.com');
      const userId = getUserIdFromToken(access_token);
      const channelId = await getChannelId(userId);
      const videoId = await insertReadyVideo(channelId);

      await request(app.getHttpServer())
        .get(`/videos/${videoId}/stream`)
        .expect(200);
    });

    it('GET /videos/:id/download without token → 401', async () => {
      const { access_token } =
        await registerConfirmAndLogin('auth1@example.com');
      const userId = getUserIdFromToken(access_token);
      const channelId = await getChannelId(userId);
      const videoId = await insertReadyVideo(channelId);

      await request(app.getHttpServer())
        .get(`/videos/${videoId}/download`)
        .expect(401);
    });

    it('GET /videos/:id/download with non-owner token → 200 (AUTH not OWNER)', async () => {
      const { access_token: ownerToken } =
        await registerConfirmAndLogin('owner2@example.com');
      const { access_token: otherToken } =
        await registerConfirmAndLogin('other2@example.com');
      const userId = getUserIdFromToken(ownerToken);
      const channelId = await getChannelId(userId);
      const videoId = await insertReadyVideo(channelId);

      await request(app.getHttpServer())
        .get(`/videos/${videoId}/download`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);
    });

    it('DELETE /videos/:id with token of different channel → 403', async () => {
      const { access_token: ownerToken } =
        await registerConfirmAndLogin('owner3@example.com');
      const { access_token: otherToken } =
        await registerConfirmAndLogin('other3@example.com');
      const userId = getUserIdFromToken(ownerToken);
      const channelId = await getChannelId(userId);
      const videoId = await insertReadyVideo(channelId);

      await request(app.getHttpServer())
        .delete(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('GET /videos/:id/stream → 409 when video is not ready', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'notready@example.com',
      );

      const initRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({ title: 'Draft Video', file_size: 1024, mime_type: 'video/mp4' })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/videos/${initRes.body.id}/stream`)
        .expect(409);
    });

    it('GET /videos/:id → 404 for nonexistent video', async () => {
      const nonExistentId = crypto.randomUUID();
      await request(app.getHttpServer())
        .get(`/videos/${nonExistentId}`)
        .expect(404);
    });
  });
});
