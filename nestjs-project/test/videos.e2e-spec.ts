import { randomUUID } from 'crypto';
import { join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { ChannelsService } from '../src/channels/channels.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { StorageService } from '../src/videos/storage.service';
import { Video, VideoStatus } from '../src/videos/video.entity';
import {
  VIDEO_PROCESSING_QUEUE,
  VIDEO_PROCESS_JOB,
} from '../src/videos/videos.constants';

const SAMPLE_VIDEO_FIXTURE = join(
  __dirname,
  '..',
  'src',
  'videos',
  'fixtures',
  'sample.mp4',
);

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string;
}

interface InitiateUploadResponseBody {
  id: string;
  status: string;
  uploadId: string;
}

interface UploadPartUrlResponseBody {
  url: string;
}

interface CompleteUploadResponseBody {
  id: string;
  status: string;
}

interface VideoReadResponseBody {
  id: string;
  title: string;
  status: string;
  durationSeconds: number | null;
  createdAt: string;
  thumbnailUrl?: string;
}

interface MeResponseBody {
  sub: string;
  email: string;
}

interface TokenPairResponseBody {
  access_token: string;
  refresh_token: string;
}

const MP4 = 'video/mp4';
const ONE_MB = 1024 * 1024;

describe('Videos (e2e)', () => {
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
    queue = moduleFixture.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
    await queue.obliterate({ force: true });
  });

  async function captureConfirmationToken(
    email: string,
    password = 'password123',
  ): Promise<string> {
    const authService = app.get(AuthService);
    const mailServiceInstance = (
      authService as unknown as { mailService: MailService }
    ).mailService;
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
  ): Promise<string> {
    const token = await captureConfirmationToken(email, password);
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return (res.body as TokenPairResponseBody).access_token;
  }

  async function createVideoWithStatus(
    email: string,
    status: VideoStatus,
  ): Promise<{ accessToken: string; videoId: string }> {
    const accessToken = await registerConfirmAndLogin(email);
    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    const { sub: userId } = meRes.body as MeResponseBody;

    const channelsService = app.get(ChannelsService);
    const channel = await channelsService.findByUserId(userId);

    const videoRepository = dataSource.getRepository(Video);
    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel!.id,
        title: 'clip',
        original_file_name: 'clip.mp4',
        mime_type: MP4,
        size_in_bytes: ONE_MB,
        storage_key: `videos/${channel!.id}/${randomUUID()}/original.mp4`,
        upload_id: status === VideoStatus.DRAFT ? randomUUID() : null,
        status,
        duration_seconds: status === VideoStatus.READY ? 42 : null,
      }),
    );

    return { accessToken, videoId: video.id };
  }

  async function createDraftVideo(
    email: string,
  ): Promise<{ accessToken: string; videoId: string }> {
    return createVideoWithStatus(email, VideoStatus.DRAFT);
  }

  async function createReadyVideoWithObject(
    email: string,
  ): Promise<{ accessToken: string; videoId: string }> {
    const { accessToken, videoId } = await createVideoWithStatus(
      email,
      VideoStatus.READY,
    );
    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: videoId });
    const storageService = app.get(StorageService);
    await storageService.uploadFile(
      video.storage_key,
      SAMPLE_VIDEO_FIXTURE,
      'video/mp4',
    );
    return { accessToken, videoId };
  }

  async function initiateVideoViaApi(
    email: string,
  ): Promise<{ accessToken: string; videoId: string }> {
    const accessToken = await registerConfirmAndLogin(email);
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        originalFileName: 'clip.mp4',
        mimeType: MP4,
        sizeInBytes: ONE_MB,
      });
    const { id } = res.body as InitiateUploadResponseBody;
    return { accessToken, videoId: id };
  }

  async function uploadPart(
    accessToken: string,
    videoId: string,
    partNumber: number,
    body: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload-part-url`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ partNumber });
    const { url } = res.body as UploadPartUrlResponseBody;
    const putResponse = await fetch(url, { method: 'PUT', body });
    return putResponse.headers.get('etag')!;
  }

  describe('POST /videos', () => {
    it('returns 201 with { id, status, uploadId } on valid registration', async () => {
      const accessToken = await registerConfirmAndLogin('uploader@example.com');

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalFileName: 'clip.mp4',
          mimeType: MP4,
          sizeInBytes: ONE_MB,
        })
        .expect(201);

      const body = res.body as InitiateUploadResponseBody;
      expect(body.id).toBeDefined();
      expect(body.status).toBe('draft');
      expect(body.uploadId).toBeDefined();
    });

    it('returns 401 without an Authorization header', async () => {
      await request(app.getHttpServer())
        .post('/videos')
        .send({
          originalFileName: 'clip.mp4',
          mimeType: MP4,
          sizeInBytes: ONE_MB,
        })
        .expect(401);
    });

    it('returns 400 with UNSUPPORTED_MEDIA_TYPE for a disallowed mimeType', async () => {
      const accessToken = await registerConfirmAndLogin('media@example.com');

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalFileName: 'doc.pdf',
          mimeType: 'application/pdf',
          sizeInBytes: ONE_MB,
        })
        .expect(400);

      expect((res.body as ErrorResponseBody).error).toBe(
        'UNSUPPORTED_MEDIA_TYPE',
      );
    });

    it('returns 400 with FILE_TOO_LARGE when sizeInBytes exceeds 10GB', async () => {
      const accessToken = await registerConfirmAndLogin('bigfile@example.com');

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalFileName: 'huge.mp4',
          mimeType: MP4,
          sizeInBytes: 10 * 1024 * 1024 * 1024 + 1,
        })
        .expect(400);

      expect((res.body as ErrorResponseBody).error).toBe('FILE_TOO_LARGE');
    });
  });

  describe('POST /videos/:id/upload-part-url', () => {
    it('returns 200 with { url } for the video owner', async () => {
      const { accessToken, videoId } = await createDraftVideo(
        'part-owner@example.com',
      );

      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload-part-url`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ partNumber: 1 })
        .expect(200);

      expect((res.body as UploadPartUrlResponseBody).url).toBeTruthy();
    });

    it('returns 404 with VIDEO_NOT_FOUND for a non-owner', async () => {
      const { videoId } = await createDraftVideo('part-owner2@example.com');
      const intruderToken = await registerConfirmAndLogin(
        'part-intruder@example.com',
      );

      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload-part-url`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ partNumber: 1 })
        .expect(404);

      expect((res.body as ErrorResponseBody).error).toBe('VIDEO_NOT_FOUND');
    });

    it('returns 400 with UPLOAD_PART_INVALID for a part number below 1', async () => {
      const { accessToken, videoId } = await createDraftVideo(
        'part-invalid@example.com',
      );

      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload-part-url`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ partNumber: 0 })
        .expect(400);

      expect((res.body as ErrorResponseBody).error).toBe('UPLOAD_PART_INVALID');
    });
  });

  describe('POST /videos/:id/complete-upload', () => {
    it('returns 200 with { id, status: "uploaded" } and enqueues processing for the owner', async () => {
      const { accessToken, videoId } = await initiateVideoViaApi(
        'complete-owner@example.com',
      );
      const etag = await uploadPart(accessToken, videoId, 1, 'fake-mp4');

      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete-upload`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ partNumber: 1, etag }] })
        .expect(200);

      const body = res.body as CompleteUploadResponseBody;
      expect(body.id).toBe(videoId);
      expect(body.status).toBe('uploaded');

      const jobs = await queue.getJobs(['waiting', 'active', 'completed']);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe(VIDEO_PROCESS_JOB);
      expect(jobs[0].data).toEqual({ videoId });
    });

    it('returns 409 with INVALID_VIDEO_STATUS_TRANSITION on a second completion', async () => {
      const { accessToken, videoId } = await initiateVideoViaApi(
        'complete-twice@example.com',
      );
      const etag = await uploadPart(accessToken, videoId, 1, 'fake-mp4');
      await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete-upload`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ partNumber: 1, etag }] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete-upload`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ partNumber: 1, etag }] })
        .expect(409);

      expect((res.body as ErrorResponseBody).error).toBe(
        'INVALID_VIDEO_STATUS_TRANSITION',
      );
    });

    it('returns 404 with VIDEO_NOT_FOUND for a non-owner', async () => {
      const { videoId } = await initiateVideoViaApi(
        'complete-owner2@example.com',
      );
      const intruderToken = await registerConfirmAndLogin(
        'complete-intruder@example.com',
      );

      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete-upload`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ parts: [{ partNumber: 1, etag: '"deadbeef"' }] })
        .expect(404);

      expect((res.body as ErrorResponseBody).error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /videos/:id', () => {
    it('returns 200 with metadata anonymously for a ready video', async () => {
      const { videoId } = await createVideoWithStatus(
        'read-ready@example.com',
        VideoStatus.READY,
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${videoId}`)
        .expect(200);

      const body = res.body as VideoReadResponseBody;
      expect(body.id).toBe(videoId);
      expect(body.status).toBe('ready');
      expect(body.durationSeconds).toBe(42);
    });

    it('returns 404 with VIDEO_NOT_FOUND anonymously for a non-ready video', async () => {
      const { videoId } = await createVideoWithStatus(
        'read-processing@example.com',
        VideoStatus.PROCESSING,
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${videoId}`)
        .expect(404);

      expect((res.body as ErrorResponseBody).error).toBe('VIDEO_NOT_FOUND');
    });

    it('returns 200 for the owner regardless of status', async () => {
      const { accessToken, videoId } = await createVideoWithStatus(
        'read-owner@example.com',
        VideoStatus.PROCESSING,
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect((res.body as VideoReadResponseBody).status).toBe('processing');
    });

    it('returns 404 with VIDEO_NOT_FOUND for an authenticated non-owner on a non-ready video', async () => {
      const { videoId } = await createVideoWithStatus(
        'read-owner2@example.com',
        VideoStatus.PROCESSING,
      );
      const intruderToken = await registerConfirmAndLogin(
        'read-intruder@example.com',
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);

      expect((res.body as ErrorResponseBody).error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /videos/:id/stream', () => {
    it('returns 302 with a Location pointing to storage for a ready video', async () => {
      const { videoId } = await createReadyVideoWithObject(
        'stream-ready@example.com',
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${videoId}/stream`)
        .expect(302);

      expect(res.headers.location).toBeTruthy();
    });

    it('returns 404 with VIDEO_NOT_FOUND for a non-owner on a non-ready video', async () => {
      const { videoId } = await createVideoWithStatus(
        'stream-processing@example.com',
        VideoStatus.PROCESSING,
      );
      const intruderToken = await registerConfirmAndLogin(
        'stream-intruder@example.com',
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${videoId}/stream`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);

      expect((res.body as ErrorResponseBody).error).toBe('VIDEO_NOT_FOUND');
    });

    it('supports Range requests with 206 Partial Content at the redirected Location', async () => {
      const { videoId } = await createReadyVideoWithObject(
        'stream-range@example.com',
      );

      const redirectRes = await request(app.getHttpServer())
        .get(`/videos/${videoId}/stream`)
        .expect(302);

      const location = redirectRes.headers.location;
      const rangeRes = await fetch(location, {
        headers: { Range: 'bytes=0-99' },
      });

      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers.get('content-range')).toBeTruthy();
    });
  });

  describe('GET /videos/:id/download', () => {
    it('returns 302 with a Location that serves the file as an attachment', async () => {
      const { videoId } = await createReadyVideoWithObject(
        'download-ready@example.com',
      );

      const redirectRes = await request(app.getHttpServer())
        .get(`/videos/${videoId}/download`)
        .expect(302);

      const location = redirectRes.headers.location;
      expect(location).toBeTruthy();

      const downloadRes = await fetch(location);
      expect(downloadRes.headers.get('content-disposition')).toContain(
        'attachment',
      );
    });

    it('returns 404 with VIDEO_NOT_FOUND for a non-owner on a non-ready video', async () => {
      const { videoId } = await createVideoWithStatus(
        'download-processing@example.com',
        VideoStatus.PROCESSING,
      );
      const intruderToken = await registerConfirmAndLogin(
        'download-intruder@example.com',
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${videoId}/download`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);

      expect((res.body as ErrorResponseBody).error).toBe('VIDEO_NOT_FOUND');
    });
  });
});
