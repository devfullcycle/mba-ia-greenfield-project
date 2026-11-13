import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/enums/video-status.enum';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { StorageService } from '../src/videos/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('Videos upload (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let confirmationToken = '';

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
    await moduleFixture.get(StorageService).ensureBucket();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    confirmationToken = '';
  });

  async function login(): Promise<string> {
    const email = `videos-${Date.now()}@example.com`;
    const authService = app.get(AuthService);
    const mailService = (authService as any).mailService;
    jest
      .spyOn(mailService, 'sendConfirmationEmail')
      .mockImplementationOnce(async (...args: any[]) => {
        confirmationToken = args[2] as string;
      });

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: confirmationToken })
      .expect(204);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);
    return response.body.access_token;
  }

  it('creates a draft and returns presigned multipart URLs', async () => {
    const token = await login();
    const create = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'E2E video',
        mime_type: 'video/mp4',
        file_size: 10,
      })
      .expect(201);

    expect(create.body.status).toBe('DRAFT');
    const videoId = create.body.id as string;

    const started = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        mime_type: 'video/mp4',
        part_size: 5 * 1024 * 1024,
        total_parts: 1,
      })
      .expect(200);

    expect(started.body.status).toBe('UPLOADING');
    const parts = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ part_numbers: [1] })
      .expect(200);

    expect(parts.body.parts[0].url).toContain('X-Amz-Signature');
    const uploadResponse = await fetch(parts.body.parts[0].url, {
      method: 'PUT',
      body: Buffer.from('not-a-real-video'),
      headers: { 'Content-Type': 'video/mp4' },
    });
    expect(uploadResponse.status).toBe(200);
    const etag = uploadResponse.headers.get('etag');
    expect(etag).toBeTruthy();

    const completed = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ part: 1, etag }] })
      .expect(200);

    expect(completed.body).toEqual(
      expect.objectContaining({
        id: videoId,
        status: 'PROCESSING',
        queued: true,
      }),
    );

    await dataSource
      .getRepository(Video)
      .update(videoId, { status: VideoStatus.READY });
    const streamed = await request(app.getHttpServer())
      .get(`/videos/${videoId}/stream`)
      .set('Range', 'bytes=0-4')
      .expect(206);
    expect(streamed.headers['content-range']).toBe('bytes 0-4/16');
    expect(streamed.headers['accept-ranges']).toBe('bytes');
    expect(streamed.body).toEqual(Buffer.from('not-a'));

    const downloaded = await request(app.getHttpServer())
      .get(`/videos/${videoId}/download`)
      .expect(200);
    expect(downloaded.headers['content-disposition']).toContain(
      `video-${videoId}.mp4`,
    );
  });
});
