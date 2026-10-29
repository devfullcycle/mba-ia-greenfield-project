import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { registerConfirmAndLogin } from '../src/test/e2e-auth';
import { Video } from '../src/videos/entities/video.entity';
import { ProcessingStatus } from '../src/videos/video.enums';

interface InitUploadBody {
  id: string;
  partCount: number;
}

interface SignPartsBody {
  parts: { partNumber: number; url: string }[];
  expiresInSeconds: number;
  error: string;
}

describe('POST /videos/:id/parts (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let otherToken: string;
  let videoId: string;

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
    videoRepository = dataSource.getRepository(Video);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
    ownerToken = await registerConfirmAndLogin(app, 'owner@example.com');
    otherToken = await registerConfirmAndLogin(app, 'other@example.com');

    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        originalFilename: 'clip.mp4',
        contentType: 'video/mp4',
        sizeBytes: 200 * 1024 * 1024,
      })
      .expect(201);
    videoId = (res.body as InitUploadBody).id;
  });

  function signParts(token: string, id: string, partNumbers: number[]) {
    return request(app.getHttpServer())
      .post(`/videos/${id}/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ partNumbers });
  }

  it('returns 200 with one presigned URL per requested part', async () => {
    const res = await signParts(ownerToken, videoId, [1, 2]).expect(200);

    const body = res.body as SignPartsBody;
    expect(body.parts).toHaveLength(2);
    expect(body.parts.map((part) => part.partNumber)).toEqual([1, 2]);
    body.parts.forEach((part) => expect(part.url).toContain('partNumber='));
    expect(body.expiresInSeconds).toBeGreaterThan(0);
  });

  it('returns 403 VIDEO_FORBIDDEN when another user asks for the parts', async () => {
    const res = await signParts(otherToken, videoId, [1]).expect(403);

    expect((res.body as SignPartsBody).error).toBe('VIDEO_FORBIDDEN');
  });

  it('returns 404 VIDEO_NOT_FOUND for an unknown video', async () => {
    const res = await signParts(ownerToken, 'unknownid01', [1]).expect(404);

    expect((res.body as SignPartsBody).error).toBe('VIDEO_NOT_FOUND');
  });

  it('returns 409 UPLOAD_NOT_IN_PROGRESS once the video left UPLOADING', async () => {
    await videoRepository.update(
      { publicId: videoId },
      { processingStatus: ProcessingStatus.PROCESSING },
    );

    const res = await signParts(ownerToken, videoId, [1]).expect(409);

    expect((res.body as SignPartsBody).error).toBe('UPLOAD_NOT_IN_PROGRESS');
  });

  it('returns 400 when partNumbers is empty', async () => {
    const res = await signParts(ownerToken, videoId, []).expect(400);

    expect((res.body as SignPartsBody).error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when a part number is beyond the upload part count', async () => {
    const res = await signParts(ownerToken, videoId, [99]).expect(400);

    expect((res.body as SignPartsBody).error).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without an Authorization header', async () => {
    await request(app.getHttpServer())
      .post(`/videos/${videoId}/parts`)
      .send({ partNumbers: [1] })
      .expect(401);
  });
});
