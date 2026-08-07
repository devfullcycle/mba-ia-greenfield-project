import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { VIDEO_QUEUE } from '../src/queue/video-jobs';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('Videos upload (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let queue: Queue;

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
    queue = moduleFixture.get<Queue>(getQueueToken(VIDEO_QUEUE));
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function login(email: string): Promise<string> {
    const authService = app.get(AuthService);
    const mailService = (authService as any).mailService;
    let token = '';
    jest
      .spyOn(mailService, 'sendConfirmationEmail')
      .mockImplementationOnce(async (...args: unknown[]) => {
        token = args[2] as string;
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
    return res.body.access_token as string;
  }

  it('rejects an unauthenticated upload initiation', async () => {
    await request(app.getHttpServer())
      .post('/videos')
      .send({
        title: 'x',
        filename: 'x.mp4',
        contentType: 'video/mp4',
        fileSize: 100,
      })
      .expect(401);
  });

  it('rejects a non-video content type with 415', async () => {
    const token = await login('owner1@test.local');
    await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'x',
        filename: 'x.png',
        contentType: 'image/png',
        fileSize: 100,
      })
      .expect(415);
  });

  it('rejects a file larger than 10GB with 413', async () => {
    const token = await login('owner2@test.local');
    await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'x',
        filename: 'x.mp4',
        contentType: 'video/mp4',
        fileSize: 10_737_418_241,
      })
      .expect(413);
  });

  it('runs the full upload flow: initiate -> upload part -> complete', async () => {
    const token = await login('owner3@test.local');
    const content = Buffer.from('fake-but-uploadable-video-bytes');

    const initiate = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'My first video',
        filename: 'first.mp4',
        contentType: 'video/mp4',
        fileSize: content.length,
      })
      .expect(201);

    expect(initiate.body.status).toBe('draft');
    expect(initiate.body.parts).toHaveLength(1);
    const { videoId, parts } = initiate.body;

    const putRes = await fetch(parts[0].url, { method: 'PUT', body: content });
    expect(putRes.ok).toBe(true);
    const etag = putRes.headers.get('etag');

    const complete = await request(app.getHttpServer())
      .post(`/videos/${videoId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, etag }] })
      .expect(200);

    expect(complete.body.status).toBe('processing');

    // a processing job was enqueued
    const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
    expect(
      counts.waiting + counts.delayed + counts.active,
    ).toBeGreaterThanOrEqual(1);
  });

  it('rejects completing a video owned by another user with 403', async () => {
    const ownerToken = await login('owner4@test.local');
    const content = Buffer.from('bytes');
    const initiate = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'v',
        filename: 'v.mp4',
        contentType: 'video/mp4',
        fileSize: content.length,
      })
      .expect(201);
    const putRes = await fetch(initiate.body.parts[0].url, {
      method: 'PUT',
      body: content,
    });
    const etag = putRes.headers.get('etag');

    const intruderToken = await login('intruder@test.local');
    await request(app.getHttpServer())
      .post(`/videos/${initiate.body.videoId}/complete`)
      .set('Authorization', `Bearer ${intruderToken}`)
      .send({ parts: [{ partNumber: 1, etag }] })
      .expect(403);
  });

  it('rejects completing a non-draft video with 409', async () => {
    const token = await login('owner5@test.local');
    const content = Buffer.from('bytes-again');
    const initiate = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'v',
        filename: 'v.mp4',
        contentType: 'video/mp4',
        fileSize: content.length,
      })
      .expect(201);
    const putRes = await fetch(initiate.body.parts[0].url, {
      method: 'PUT',
      body: content,
    });
    const etag = putRes.headers.get('etag');
    const body = { parts: [{ partNumber: 1, etag }] };

    await request(app.getHttpServer())
      .post(`/videos/${initiate.body.videoId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/videos/${initiate.body.videoId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(409);
  });
});
