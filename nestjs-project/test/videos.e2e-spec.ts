import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { QUEUES } from '../src/queue/queue.constants';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/enums/video-status.enum';
import { registerConfirmAndLogin } from './helpers/auth-e2e.helpers';

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let queue: Queue;
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
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    queue = moduleFixture.get<Queue>(getQueueToken(QUEUES.VIDEO_PROCESSING));
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.obliterate({ force: true });
    throttlerStorage.storage.clear();
  });

  const validCreateBody = {
    title: 'My Video',
    file_name: 'video.mp4',
    file_size: 250_000_000,
    content_type: 'video/mp4',
  };

  // 1. Criar rascunho e concluir upload (SI-03.5)
  describe('POST /videos', () => {
    it('rejects-create-without-authentication', async () => {
      await request(app.getHttpServer())
        .post('/videos')
        .send(validCreateBody)
        .expect(401);
    });

    it('rejects-create-without-channel', async () => {
      const { access_token } = await registerConfirmAndLogin(
        app,
        'no-channel@example.com',
      );
      const user = await dataSource
        .getRepository(User)
        .findOneByOrFail({ email: 'no-channel@example.com' });
      await channelRepository.delete({ user_id: user.id });

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send(validCreateBody)
        .expect(403);

      expect(res.body.error).toBe('CHANNEL_REQUIRED');
    });

    it('rejects-invalid-file-size', async () => {
      const { access_token } = await registerConfirmAndLogin(
        app,
        'big-file@example.com',
      );

      await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({ ...validCreateBody, file_size: 10_737_418_240 + 1 })
        .expect(400);
    });

    it('creates-draft-and-returns-multipart-urls', async () => {
      const { access_token } = await registerConfirmAndLogin(
        app,
        'creator@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send(validCreateBody)
        .expect(201);

      expect(res.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(res.body.slug).toHaveLength(11);
      expect(Array.isArray(res.body.parts)).toBe(true);
      expect(res.body.parts.length).toBeGreaterThan(0);
      expect(res.body.part_size).toBe(100_000_000);
    });
  });

  describe('POST /videos/:id/upload-complete', () => {
    it('rejects-upload-complete-wrong-owner', async () => {
      const owner = await registerConfirmAndLogin(app, 'owner-a@example.com');
      const createRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${owner.access_token}`)
        .send(validCreateBody);
      const videoId = createRes.body.id;

      const other = await registerConfirmAndLogin(app, 'owner-b@example.com');

      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload-complete`)
        .set('Authorization', `Bearer ${other.access_token}`)
        .send({ parts: [{ part_number: 1, etag: 'abc' }] })
        .expect(403);

      expect(res.body.error).toBe('VIDEO_ACCESS_DENIED');
    });

    it('rejects-upload-complete-invalid-status', async () => {
      const { access_token } = await registerConfirmAndLogin(
        app,
        'bad-status@example.com',
      );
      const createRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send(validCreateBody);
      const videoId = createRes.body.id;

      await videoRepository.update(
        { id: videoId },
        { status: VideoStatus.PROCESSING },
      );

      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload-complete`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ parts: [{ part_number: 1, etag: 'abc' }] })
        .expect(409);

      expect(res.body.error).toBe('VIDEO_INVALID_STATUS');
    });

    it('completes-upload-and-publishes-job', async () => {
      const { access_token } = await registerConfirmAndLogin(
        app,
        'completer@example.com',
      );
      const createRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({ ...validCreateBody, file_size: 50_000_000 });
      const videoId = createRes.body.id;
      const [firstPart] = createRes.body.parts;
      expect(createRes.body.parts).toHaveLength(1);

      const putResponse = await fetch(firstPart.upload_url, {
        method: 'PUT',
        body: 'e2e-test-part-payload',
      });
      const etag = putResponse.headers.get('etag');
      if (!etag) {
        throw new Error('MinIO did not return an ETag for the uploaded part');
      }

      await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload-complete`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ parts: [{ part_number: firstPart.part_number, etag }] })
        .expect(204);

      const video = await videoRepository.findOneBy({ id: videoId });
      expect(video?.status).toBe(VideoStatus.PROCESSING);

      const jobs = await queue.getJobs(['waiting', 'active', 'completed']);
      const job = jobs.find((j) => j.data.videoId === videoId);
      expect(job).toBeDefined();
      expect(job?.name).toBe('process-video');
    });
  });

  // 2. Endpoints de recuperação (streaming e download) (SI-03.7)
  async function createChannelIdFor(email: string): Promise<string> {
    await registerConfirmAndLogin(app, email);
    const user = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email });
    const channel = await channelRepository.findOneByOrFail({
      user_id: user.id,
    });
    return channel.id;
  }

  async function createVideo(
    channelId: string,
    slug: string,
    overrides: Partial<Video> = {},
  ): Promise<Video> {
    const video = videoRepository.create({
      channel_id: channelId,
      title: 'Recovery Test Video',
      slug,
      storage_key: `videos/${slug}/original`,
      status: VideoStatus.DRAFT,
      ...overrides,
    });
    return videoRepository.save(video);
  }

  describe('GET /videos/:slug', () => {
    it('returns-404-for-unknown-slug', async () => {
      const res = await request(app.getHttpServer())
        .get('/videos/slug-inexistente')
        .expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('returns-draft-video-with-null-thumbnail', async () => {
      const channelId = await createChannelIdFor('draft-owner@example.com');
      await createVideo(channelId, 'draftslug01', {
        status: VideoStatus.DRAFT,
        thumbnail_key: null,
      });

      const res = await request(app.getHttpServer())
        .get('/videos/draftslug01')
        .expect(200);

      expect(res.body.status).toBe('draft');
      expect(res.body.thumbnail_url).toBeNull();
    });
  });

  describe('GET /videos/:slug/stream-url', () => {
    it('rejects-stream-url-when-not-ready', async () => {
      const channelId = await createChannelIdFor('stream-notready@example.com');
      await createVideo(channelId, 'notreadyslg', {
        status: VideoStatus.PROCESSING,
      });

      const res = await request(app.getHttpServer())
        .get('/videos/notreadyslg/stream-url')
        .expect(409);

      expect(res.body.error).toBe('VIDEO_NOT_READY');
    });

    it('returns-stream-url-for-ready-video', async () => {
      const channelId = await createChannelIdFor('stream-ready@example.com');
      await createVideo(channelId, 'readyslug01', {
        status: VideoStatus.READY,
      });

      const res = await request(app.getHttpServer())
        .get('/videos/readyslug01/stream-url')
        .expect(200);

      expect(typeof res.body.url).toBe('string');
      expect(res.body.url.length).toBeGreaterThan(0);
      expect(new Date(res.body.expires_at).toString()).not.toBe('Invalid Date');
    });
  });

  describe('GET /videos/:slug/download-url', () => {
    it('rejects-unauthenticated-download-url', async () => {
      const channelId = await createChannelIdFor('download-noauth@example.com');
      await createVideo(channelId, 'noauthslug1', {
        status: VideoStatus.READY,
      });

      await request(app.getHttpServer())
        .get('/videos/noauthslug1/download-url')
        .expect(401);
    });

    it('returns-download-url-with-content-disposition', async () => {
      const { access_token } = await registerConfirmAndLogin(
        app,
        'downloader@example.com',
      );
      const user = await dataSource
        .getRepository(User)
        .findOneByOrFail({ email: 'downloader@example.com' });
      const channel = await channelRepository.findOneByOrFail({
        user_id: user.id,
      });
      await createVideo(channel.id, 'downloadslg', {
        status: VideoStatus.READY,
      });

      const res = await request(app.getHttpServer())
        .get('/videos/downloadslg/download-url')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);

      expect(res.body.url).toContain('response-content-disposition=attachment');
    });
  });
});
