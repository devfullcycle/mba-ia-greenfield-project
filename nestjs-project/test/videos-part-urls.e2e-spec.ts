import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';

interface ErrorBody {
  error: string;
}

describe('POST /videos/:publicId/upload/part-urls (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let otherToken: string;
  let publicId: string;
  const openUploads: { key: string; uploadId: string }[] = [];

  beforeAll(async () => {
    // Tests run inside the container: sign against the internal storage host.
    process.env.STORAGE_PUBLIC_ENDPOINT = process.env.STORAGE_ENDPOINT;
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
    ownerToken = await registerConfirmAndLogin('owner@example.com');
    otherToken = await registerConfirmAndLogin('other@example.com');
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        filename: 'clip.mp4',
        size_bytes: 1024,
        content_type: 'video/mp4',
      })
      .expect(201);
    const body = res.body as { public_id: string; upload_id: string };
    publicId = body.public_id;
    const video = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: publicId });
    openUploads.push({ key: video.storage_key, uploadId: body.upload_id });
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

  const signParts = (id: string, token: string, partNumbers: number[]) =>
    request(app.getHttpServer())
      .post(`/videos/${id}/upload/part-urls`)
      .set('Authorization', `Bearer ${token}`)
      .send({ part_numbers: partNumbers });

  it('returns 200 with one presigned URL per requested part', async () => {
    const res = await signParts(publicId, ownerToken, [1, 2]).expect(200);

    const { urls } = res.body as {
      urls: { part_number: number; url: string }[];
    };
    expect(urls).toHaveLength(2);
    expect(urls.map((u) => u.part_number)).toEqual([1, 2]);
    urls.forEach((u) => expect(u.url).toMatch(/^https?:\/\//));
  });

  it('returns 403 VIDEO_FORBIDDEN for another authenticated user', async () => {
    const res = await signParts(publicId, otherToken, [1]).expect(403);

    expect((res.body as ErrorBody).error).toBe('VIDEO_FORBIDDEN');
  });

  it('returns 404 VIDEO_NOT_FOUND for an unknown publicId', async () => {
    const res = await signParts('inexistente', ownerToken, [1]).expect(404);

    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
  });

  it('returns 409 UPLOAD_ALREADY_COMPLETED once the upload is complete', async () => {
    const signed = await signParts(publicId, ownerToken, [1]).expect(200);
    const [{ url }] = (signed.body as { urls: { url: string }[] }).urls;
    const put = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(1024),
    });
    expect(put.status).toBe(200);
    await request(app.getHttpServer())
      .post(`/videos/${publicId}/upload/complete`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ parts: [{ part_number: 1, etag: put.headers.get('etag') }] })
      .expect(202);

    const res = await signParts(publicId, ownerToken, [1]).expect(409);

    expect((res.body as ErrorBody).error).toBe('UPLOAD_ALREADY_COMPLETED');
  });

  it('returns 400 VALIDATION_ERROR when part_numbers is empty', async () => {
    const res = await signParts(publicId, ownerToken, []).expect(400);

    expect((res.body as ErrorBody).error).toBe('VALIDATION_ERROR');
  });
});
