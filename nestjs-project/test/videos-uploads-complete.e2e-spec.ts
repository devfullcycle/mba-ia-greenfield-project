import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { VIDEO_PROCESSING_QUEUE } from '../src/queue/queue.constants';
import { VideoProcessingQueue } from '../src/queue/video-processing.queue';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import {
  createE2eApp,
  registerConfirmAndLogin,
  resetThrottler,
} from './utils/e2e-app';

interface InitiateBody {
  id: string;
  parts: { part_number: number; url: string }[];
}

interface ErrorBody {
  error: string;
}

const SIZE_BYTES = 256 * 1024; // single part (< 5 MiB)

interface DraftUpload {
  publicId: string;
  etag: string;
}

/** Creates a DRAFT as `token` and PUTs its single part, returning the ETag. */
async function createUploadedDraft(
  app: INestApplication<App>,
  token: string,
): Promise<DraftUpload> {
  const res = await request(app.getHttpServer())
    .post('/videos/uploads')
    .set('Authorization', `Bearer ${token}`)
    .send({
      original_filename: 'clip.mp4',
      mime_type: 'video/mp4',
      size_bytes: SIZE_BYTES,
    })
    .expect(201);
  const body = res.body as InitiateBody;
  const put = await fetch(body.parts[0].url, {
    method: 'PUT',
    body: new Uint8Array(SIZE_BYTES),
  });
  return { publicId: body.id, etag: put.headers.get('etag')! };
}

describe('videos-uploads-complete', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let queue: Queue;
  let token: string;
  let draft: DraftUpload;

  beforeAll(async () => {
    ({ app, moduleFixture } = await createE2eApp());
    dataSource = moduleFixture.get(DataSource);
    queue = moduleFixture.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.obliterate({ force: true });
    resetThrottler(moduleFixture);
    token = await registerConfirmAndLogin(app, 'uploader@example.com');
    draft = await createUploadedDraft(app, token);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const complete = (
    target: INestApplication<App>,
    publicId: string,
    parts: { part_number: number; etag: string }[],
  ) =>
    request(target.getHttpServer())
      .post(`/videos/${publicId}/uploads/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts });

  const findVideo = (publicId: string) =>
    dataSource.getRepository(Video).findOneByOrFail({ public_id: publicId });

  // 1. Finalizar upload multipart e enfileirar processamento

  test('completar-upload-retorna-202-e-monta-objeto', async () => {
    const res = await complete(app, draft.publicId, [
      { part_number: 1, etag: draft.etag },
    ]).expect(202);

    expect(res.body).toEqual({ id: draft.publicId, status: 'PROCESSING' });
    const video = await findVideo(draft.publicId);
    const head = await app.get(StorageService).headObject(video.storage_key);
    expect(head.contentLength).toBe(SIZE_BYTES);
    expect(video.status).toBe('PROCESSING');
  });

  test('completar-upload-enfileira-job-process-video', async () => {
    await complete(app, draft.publicId, [
      { part_number: 1, etag: draft.etag },
    ]).expect(202);

    const video = await findVideo(draft.publicId);
    const job = await queue.getJob(video.id);
    expect(job?.name).toBe('process-video');
    expect(job?.id).toBe(video.id);
    expect(job?.data).toEqual({ videoId: video.id });
  });

  test('completar-upload-com-enqueue-falhando-ainda-retorna-202', async () => {
    const { app: failingApp } = await createE2eApp((builder) =>
      builder.overrideProvider(VideoProcessingQueue).useValue({
        enqueue: () => Promise.reject(new Error('Redis unavailable')),
      }),
    );
    try {
      const res = await complete(failingApp, draft.publicId, [
        { part_number: 1, etag: draft.etag },
      ]).expect(202);

      expect((res.body as { status: string }).status).toBe('PROCESSING');
      expect((await findVideo(draft.publicId)).status).toBe('PROCESSING');
    } finally {
      await failingApp.close();
    }
  });

  test('completar-upload-etag-incorreto-mantem-draft', async () => {
    const res = await complete(app, draft.publicId, [
      { part_number: 1, etag: '"etag-invalido"' },
    ]).expect(400);

    expect((res.body as ErrorBody).error).toBe('INVALID_UPLOAD_PARTS');
    const video = await findVideo(draft.publicId);
    expect(video.status).toBe('DRAFT');
    expect(await queue.getJob(video.id)).toBeUndefined();
  });

  test('completar-upload-repetido-retorna-409', async () => {
    const parts = [{ part_number: 1, etag: draft.etag }];
    await complete(app, draft.publicId, parts).expect(202);

    const res = await complete(app, draft.publicId, parts).expect(409);

    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_IN_DRAFT');
  });

  test('completar-upload-parts-vazio-retorna-validation-error', async () => {
    const res = await complete(app, draft.publicId, []).expect(400);

    expect((res.body as ErrorBody).error).toBe('VALIDATION_ERROR');
    expect((await findVideo(draft.publicId)).status).toBe('DRAFT');
  });

  test('completar-upload-com-milhares-de-partes-nao-estoura-limite-do-body', async () => {
    // A 10GB upload completes with ~2,000-10,000 parts (> Express' 100kb default).
    const parts = Array.from({ length: 10_000 }, (_, index) => ({
      part_number: index + 1,
      etag: '"00000000000000000000000000000000"',
    }));

    const res = await complete(app, draft.publicId, parts);

    expect(res.status).not.toBe(413);
    expect((res.body as ErrorBody).error).toBe('INVALID_UPLOAD_PARTS');
  });
});
