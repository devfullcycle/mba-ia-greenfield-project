import * as crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { VIDEO_PROCESSING_QUEUE } from '../src/queue/queue.constants';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { MailService } from '../src/mail/mail.service';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { FfmpegService } from '../src/video-worker/services/ffmpeg.service';
import { Channel } from '../src/channels/entities/channel.entity';

const VIDEO_BYTES = Buffer.from('fake video bytes used by the e2e suite');

const ffmpegMock = {
  extractMetadata: jest.fn().mockResolvedValue({
    duration: 7,
    width: 640,
    height: 360,
  }),
  generateThumbnail: jest
    .fn()
    .mockImplementation((_input: string, output: string) =>
      writeFile(output, Buffer.from('thumbnail')),
    ),
};

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channelRepository: Repository<Channel>;
  let throttlerStorage: ThrottlerStorageService;
  let queue: Queue;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FfmpegService)
      .useValue(ffmpegMock)
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
    videoRepository = dataSource.getRepository(Video);
    channelRepository = dataSource.getRepository(Channel);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
    queue = moduleFixture.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));

    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    try {
      await queue?.close();
    } catch {
      // Ignored
    }
    await app.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  let userCounter = 0;

  async function registerUser(): Promise<{
    token: string;
    userId: string;
    channelId: string;
  }> {
    const email = `videos_e2e_${++userCounter}@example.com`;
    const password = 'password123';
    const mailService = app.get(MailService);

    let confirmationToken = '';
    jest
      .spyOn(mailService, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_email, _name, token) => {
        confirmationToken = token;
      });

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: confirmationToken })
      .expect(204);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const token = login.body.access_token as string;
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const channel = await channelRepository.findOneByOrFail({
      user_id: me.body.sub as string,
    });

    return { token, userId: me.body.sub as string, channelId: channel.id };
  }

  async function uploadVideo(
    token: string,
    filename = 'My Video.mp4',
  ): Promise<Record<string, unknown>> {
    const response = await request(app.getHttpServer())
      .post('/videos/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', VIDEO_BYTES, { filename, contentType: 'video/mp4' })
      .expect(201);

    return response.body as Record<string, unknown>;
  }

  async function waitForReady(
    videoId: string,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await request(app.getHttpServer())
        .get(`/videos/${videoId}`)
        .expect(200);

      const body = response.body as Record<string, unknown>;
      if (body.status === VideoStatus.READY) {
        return body;
      }
      if (body.status === VideoStatus.ERROR) {
        const row = await videoRepository.findOneBy({ id: videoId });
        throw new Error(`Video processing failed: ${row?.error_message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error('Timed out waiting for video processing');
  }

  it('returns 401 when uploading without authentication', async () => {
    await request(app.getHttpServer())
      .post('/videos/upload')
      .attach('file', VIDEO_BYTES, {
        filename: 'video.mp4',
        contentType: 'video/mp4',
      })
      .expect(401);
  });

  it('returns 400 when uploading without a file', async () => {
    const { token } = await registerUser();

    const response = await request(app.getHttpServer())
      .post('/videos/upload')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('uploads, processes, streams (with Range) and downloads a video', async () => {
    const { token, channelId } = await registerUser();

    const uploaded = await uploadVideo(token);
    expect(uploaded).toMatchObject({
      status: VideoStatus.PROCESSING,
      original_filename: 'My Video.mp4',
      channel_id: channelId,
    });

    const videoId = uploaded.id as string;
    const ready = await waitForReady(videoId);
    expect(ready.status).toBe(VideoStatus.READY);
    expect(ready.duration_seconds).toBe(7);
    expect(ready.thumbnail_key).toBe(`thumbnails/${videoId}/thumbnail.jpg`);

    const full = await request(app.getHttpServer())
      .get(`/videos/${videoId}/stream`)
      .expect(200);
    expect(full.headers['content-type']).toMatch(/^video\/mp4/);
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(Buffer.from(full.body).toString()).toBe(VIDEO_BYTES.toString());

    const partial = await request(app.getHttpServer())
      .get(`/videos/${videoId}/stream`)
      .set('Range', 'bytes=0-3')
      .expect(206);
    expect(partial.headers['content-range']).toBe(
      `bytes 0-3/${VIDEO_BYTES.length}`,
    );
    expect(partial.headers['content-length']).toBe('4');
    expect(partial.body).toHaveLength(4);

    const download = await request(app.getHttpServer())
      .get(`/videos/${videoId}/download`)
      .expect(200);
    expect(download.headers['content-disposition']).toBe(
      'attachment; filename="My Video.mp4"',
    );
    expect(Buffer.from(download.body).toString()).toBe(VIDEO_BYTES.toString());
  });

  it('returns 404 for unknown or malformed video ids', async () => {
    const malformed = await request(app.getHttpServer())
      .get('/videos/not-a-uuid')
      .expect(404);
    expect(malformed.body.error).toBe('VIDEO_NOT_FOUND');

    const unknown = await request(app.getHttpServer())
      .get(`/videos/${crypto.randomUUID()}`)
      .expect(404);
    expect(unknown.body.error).toBe('VIDEO_NOT_FOUND');
  });

  it('returns 409 while the video is not ready', async () => {
    const { channelId } = await registerUser();
    const video = await videoRepository.save(
      videoRepository.create({
        original_filename: 'processing.mp4',
        storage_key: 'videos/processing/processing.mp4',
        status: VideoStatus.PROCESSING,
        channel_id: channelId,
      }),
    );

    const stream = await request(app.getHttpServer())
      .get(`/videos/${video.id}/stream`)
      .expect(409);
    expect(stream.body.error).toBe('VIDEO_NOT_READY');

    const download = await request(app.getHttpServer())
      .get(`/videos/${video.id}/download`)
      .expect(409);
    expect(download.body.error).toBe('VIDEO_NOT_READY');
  });
});
