// The presigned part URLs are signed with the public storage endpoint, which
// (`localhost`) is not reachable from inside the test container. Point it at
// the internal endpoint before the app reads the config.
process.env.S3_PUBLIC_ENDPOINT = process.env.S3_ENDPOINT;

import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../src/queue/queue.constants';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { registerConfirmAndLogin } from '../src/test/e2e-auth';
import { Video } from '../src/videos/entities/video.entity';
import { ProcessingStatus } from '../src/videos/video.enums';

interface InitUploadBody {
  id: string;
}

interface SignPartsBody {
  parts: { partNumber: number; url: string }[];
}

interface CompleteBody {
  id: string;
  processingStatus: string;
  error: string;
}

const PART_BYTES = 1024 * 1024;

describe('POST /videos/:id/complete (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let queue: Queue<{ videoId: string }>;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let otherToken: string;
  const jobIdsToClean: string[] = [];

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
    queue = moduleFixture.get<Queue<{ videoId: string }>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    for (const id of jobIdsToClean) {
      const job = await queue.getJob(id);
      await job?.remove().catch(() => undefined);
    }
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
    ownerToken = await registerConfirmAndLogin(app, 'owner@example.com');
    otherToken = await registerConfirmAndLogin(app, 'other@example.com');
  });

  /** Inits an upload and sends `uploadedBytes` as part 1; returns the ETag. */
  async function startUpload(
    declaredBytes: number,
    uploadedBytes: number,
  ): Promise<{ videoId: string; etag: string }> {
    const init = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        originalFilename: 'clip.mp4',
        contentType: 'video/mp4',
        sizeBytes: declaredBytes,
      })
      .expect(201);
    const videoId = (init.body as InitUploadBody).id;

    const signed = await request(app.getHttpServer())
      .post(`/videos/${videoId}/parts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ partNumbers: [1] })
      .expect(200);
    const url = (signed.body as SignPartsBody).parts[0].url;

    const put = await fetch(url, {
      method: 'PUT',
      body: Buffer.alloc(uploadedBytes, 'a'),
    });
    expect(put.status).toBe(200);
    return { videoId, etag: put.headers.get('etag')! };
  }

  function complete(token: string, videoId: string, etag: string) {
    return request(app.getHttpServer())
      .post(`/videos/${videoId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, etag }] });
  }

  async function jobsFor(videoId: string) {
    const stored = await videoRepository.findOneByOrFail({
      publicId: videoId,
    });
    jobIdsToClean.push(stored.id);
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    return {
      stored,
      jobs: jobs.filter((job) => job.data.videoId === stored.id),
    };
  }

  it('returns 202 PROCESSING and enqueues exactly one process-video job', async () => {
    const { videoId, etag } = await startUpload(PART_BYTES, PART_BYTES);

    const res = await complete(ownerToken, videoId, etag).expect(202);

    expect((res.body as CompleteBody).processingStatus).toBe('PROCESSING');
    const { stored, jobs } = await jobsFor(videoId);
    expect(stored.processingStatus).toBe(ProcessingStatus.PROCESSING);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe(PROCESS_VIDEO_JOB);
    expect(jobs[0].data).toEqual({ videoId: stored.id });
  });

  it('is idempotent: calling complete twice keeps a single job', async () => {
    const { videoId, etag } = await startUpload(PART_BYTES, PART_BYTES);

    await complete(ownerToken, videoId, etag).expect(202);
    await complete(ownerToken, videoId, etag).expect(202);

    const { jobs } = await jobsFor(videoId);
    expect(jobs).toHaveLength(1);
  });

  it('returns 409 UPLOAD_INCOMPLETE when the stored size differs from the declared one', async () => {
    const { videoId, etag } = await startUpload(2 * PART_BYTES, PART_BYTES);

    const res = await complete(ownerToken, videoId, etag).expect(409);

    expect((res.body as CompleteBody).error).toBe('UPLOAD_INCOMPLETE');
    const { stored, jobs } = await jobsFor(videoId);
    expect(stored.processingStatus).toBe(ProcessingStatus.FAILED);
    expect(jobs).toHaveLength(0);
  });

  it('returns 409 UPLOAD_INCOMPLETE when the storage rejects the part ETag', async () => {
    const { videoId } = await startUpload(PART_BYTES, PART_BYTES);

    const res = await complete(
      ownerToken,
      videoId,
      '"00000000000000000000000000000000"',
    ).expect(409);

    expect((res.body as CompleteBody).error).toBe('UPLOAD_INCOMPLETE');
    const { stored } = await jobsFor(videoId);
    expect(stored.processingStatus).toBe(ProcessingStatus.UPLOADING);
  });

  it('returns 403 VIDEO_FORBIDDEN for a user who does not own the video', async () => {
    const { videoId, etag } = await startUpload(PART_BYTES, PART_BYTES);

    const res = await complete(otherToken, videoId, etag).expect(403);

    expect((res.body as CompleteBody).error).toBe('VIDEO_FORBIDDEN');
  });

  it('returns 404 VIDEO_NOT_FOUND for an unknown video', async () => {
    const res = await complete(ownerToken, 'unknownid01', '"etag"').expect(404);

    expect((res.body as CompleteBody).error).toBe('VIDEO_NOT_FOUND');
  });

  it('returns 400 when parts is empty', async () => {
    const { videoId } = await startUpload(PART_BYTES, PART_BYTES);

    await request(app.getHttpServer())
      .post(`/videos/${videoId}/complete`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ parts: [] })
      .expect(400);
  });

  it('returns 401 without an Authorization header', async () => {
    await request(app.getHttpServer())
      .post('/videos/anything123/complete')
      .send({ parts: [{ partNumber: 1, etag: '"etag"' }] })
      .expect(401);
  });
});
