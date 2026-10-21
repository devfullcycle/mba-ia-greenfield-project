import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import {
  MAX_VIDEO_SIZE_BYTES,
  VideoStatus,
  VideoVisibility,
} from '../src/videos/videos.constants';

interface StartUploadBody {
  public_id: string;
  upload_id: string;
  part_size_bytes: number;
  status: string;
  visibility: string;
}

interface ErrorBody {
  error: string;
}

describe('POST /videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let throttlerStorage: ThrottlerStorageService;
  let accessToken: string;
  const openUploads: { key: string; uploadId: string }[] = [];

  const validBody = {
    filename: 'clip.mp4',
    size_bytes: 2048,
    content_type: 'video/mp4',
  };

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
    storage = moduleFixture.get(StorageService);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await Promise.all(
      openUploads.map((u) => storage.abortMultipartUpload(u.key, u.uploadId)),
    );
    await cleanAllTables(dataSource);
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
    accessToken = await registerConfirmAndLogin('owner@example.com');
  });

  async function registerConfirmAndLogin(email: string): Promise<string> {
    const password = 'password123';
    const mailService = app.get(MailService);
    let token = '';
    jest
      .spyOn(mailService, 'sendConfirmationEmail')
      .mockImplementationOnce((_e: string, _n: string, t: string) => {
        token = t;
        return Promise.resolve();
      });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return (res.body as { access_token: string }).access_token;
  }

  const post = (body: object) =>
    request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

  it('returns 201 with the draft video and the open upload', async () => {
    const res = await post(validBody).expect(201);
    const body = res.body as StartUploadBody;

    expect(body.public_id).toHaveLength(11);
    expect(body.upload_id).toEqual(expect.any(String));
    expect(body.part_size_bytes).toEqual(expect.any(Number));
    expect(body.status).toBe(VideoStatus.UPLOADING);
    expect(body.visibility).toBe(VideoVisibility.DRAFT);
    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: body.public_id });
    expect(video.visibility).toBe(VideoVisibility.DRAFT);
    openUploads.push({ key: video.storage_key, uploadId: body.upload_id });
  });

  it('returns 401 without a token and creates no video', async () => {
    await request(app.getHttpServer())
      .post('/videos')
      .send(validBody)
      .expect(401);

    expect(await dataSource.getRepository(Video).count()).toBe(0);
  });

  it('returns 400 FILE_TOO_LARGE when size_bytes exceeds 10GB', async () => {
    const res = await post({
      ...validBody,
      size_bytes: MAX_VIDEO_SIZE_BYTES + 1,
    }).expect(400);

    expect((res.body as ErrorBody).error).toBe('FILE_TOO_LARGE');
  });

  it('returns 415 UNSUPPORTED_VIDEO_FORMAT for a content_type outside the accepted list', async () => {
    const res = await post({
      ...validBody,
      content_type: 'application/pdf',
    }).expect(415);

    expect((res.body as ErrorBody).error).toBe('UNSUPPORTED_VIDEO_FORMAT');
  });

  it('returns 400 VALIDATION_ERROR when filename is missing', async () => {
    const res = await post({
      size_bytes: validBody.size_bytes,
      content_type: validBody.content_type,
    }).expect(400);

    expect((res.body as ErrorBody).error).toBe('VALIDATION_ERROR');
  });
});
