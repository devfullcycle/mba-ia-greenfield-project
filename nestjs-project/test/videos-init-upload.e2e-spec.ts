import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { registerConfirmAndLogin } from '../src/test/e2e-auth';
import { Video } from '../src/videos/entities/video.entity';
import { ProcessingStatus, PublicationState } from '../src/videos/video.enums';

interface InitUploadBody {
  id: string;
  partSizeBytes: number;
  partCount: number;
  processingStatus: string;
  error: string;
}

describe('POST /videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let throttlerStorage: ThrottlerStorageService;
  let accessToken: string;

  const validBody = {
    originalFilename: 'clip.mp4',
    contentType: 'video/mp4',
    sizeBytes: 1073741824,
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
    accessToken = await registerConfirmAndLogin(app, 'uploader@example.com');
  });

  it('returns 201 with the part plan and stores a DRAFT video in UPLOADING', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody)
      .expect(201);

    const body = res.body as InitUploadBody;
    expect(body.id).toHaveLength(11);
    expect(body.processingStatus).toBe('UPLOADING');
    expect(body.partCount).toBe(
      Math.ceil(validBody.sizeBytes / body.partSizeBytes),
    );

    const stored = await videoRepository.findOneByOrFail({ publicId: body.id });
    expect(stored.publicationState).toBe(PublicationState.DRAFT);
    expect(stored.processingStatus).toBe(ProcessingStatus.UPLOADING);
    expect(stored.uploadId).toEqual(expect.any(String));
  });

  it('returns 413 VIDEO_TOO_LARGE when the declared size exceeds 10GB', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...validBody, sizeBytes: 10737418241 })
      .expect(413);

    expect((res.body as InitUploadBody).error).toBe('VIDEO_TOO_LARGE');
    expect(await videoRepository.count()).toBe(0);
  });

  it('returns 415 UNSUPPORTED_VIDEO_TYPE for a content type outside the allowlist', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        ...validBody,
        contentType: 'application/pdf',
        originalFilename: 'doc.pdf',
      })
      .expect(415);

    expect((res.body as InitUploadBody).error).toBe('UNSUPPORTED_VIDEO_TYPE');
  });

  it('returns 401 without an Authorization header', async () => {
    await request(app.getHttpServer())
      .post('/videos')
      .send(validBody)
      .expect(401);
  });

  it('returns 400 VALIDATION_ERROR when originalFilename is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ contentType: 'video/mp4', sizeBytes: 1024 })
      .expect(400);

    expect((res.body as InitUploadBody).error).toBe('VALIDATION_ERROR');
  });
});
