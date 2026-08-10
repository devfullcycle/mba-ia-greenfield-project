import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { VideoStatus } from '../src/videos/entities/video.entity';
import { VideoProcessor } from '../src/videos/processors/video.processor';

describe('Videos Upload (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let accessToken: string;
  let videoId: string;
  let uploadId: string;

  async function captureConfirmationToken(
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
      .send({ email, password })
      .expect(201);
    return capturedToken;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(VideoProcessor)
      .useValue({})
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
    app.enableShutdownHooks();
    await app.init();

    dataSource = moduleFixture.get(DataSource);

    // 1. Clean DB
    await cleanAllTables(dataSource);

    // 2. Register and capture token
    const email = 'uploader.e2e@example.com';
    const password = 'Password123!';
    const token = await captureConfirmationToken(email, password);
    expect(token).toBeDefined();

    // 3. Confirm email
    await request(app.getHttpServer())
      .get(`/auth/confirm-email`)
      .query({ token })
      .expect(204);

    // 4. Log in
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    accessToken = (loginRes.body as { access_token: string }).access_token;
    expect(accessToken).toBeDefined();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /videos/upload/initiate', () => {
    it('should reject upload initiation without auth', async () => {
      await request(app.getHttpServer())
        .post('/videos/upload/initiate')
        .send({
          title: 'My E2E Video',
          fileName: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 500000,
        })
        .expect(401);
    });

    it('should initiate video upload successfully', async () => {
      const res = await request(app.getHttpServer())
        .post('/videos/upload/initiate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'My E2E Video',
          description: 'A test video description',
          fileName: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 500000,
        })
        .expect(201);

      const body = res.body as {
        videoId: string;
        unique_url_id: string;
        uploadId: string;
        key: string;
      };
      expect(body.videoId).toBeDefined();
      expect(body.unique_url_id).toHaveLength(12);
      expect(body.uploadId).toBeDefined();
      expect(body.key).toBeDefined();

      videoId = body.videoId;
      uploadId = body.uploadId;
    });
  });

  describe('POST /videos/:id/upload/part-url', () => {
    it('should return a presigned URL for a part', async () => {
      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload/part-url`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          partNumber: 1,
          uploadId,
        })
        .expect(201);

      const body = res.body as { url: string };
      expect(body.url).toBeDefined();
      expect(typeof body.url).toBe('string');
    });

    it('should reject invalid part number', async () => {
      await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload/part-url`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          partNumber: 0,
          uploadId,
        })
        .expect(400);
    });
  });

  describe('POST /videos/:id/upload/complete', () => {
    it('should complete multipart upload and enqueue job', async () => {
      // 1. Get Part URL
      const partUrlRes = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload/part-url`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          partNumber: 1,
          uploadId,
        })
        .expect(201);

      const partUrlBody = partUrlRes.body as { url: string };
      const presignedUrl = partUrlBody.url;

      // 2. Put chunk data to S3/MinIO
      const uploadRes = await fetch(presignedUrl, {
        method: 'PUT',
        body: Buffer.from('hello chunk data'),
      });
      expect(uploadRes.status).toBe(200);
      const etag = uploadRes.headers.get('etag');
      expect(etag).toBeDefined();

      // 3. Complete Upload
      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          uploadId,
          parts: [{ ETag: etag!, PartNumber: 1 }],
        })
        .expect(200);

      const body = res.body as { success: boolean; status: string };
      expect(body.success).toBe(true);
      expect(body.status).toBe(VideoStatus.PROCESSING);
    });
  });
});
