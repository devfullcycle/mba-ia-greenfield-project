import { AbortMultipartUploadCommand, type S3Client } from '@aws-sdk/client-s3';
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { S3_INTERNAL_CLIENT } from '../src/storage/storage.constants';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { VideoPublicIdService } from '../src/videos/video-public-id.service';
import {
  createE2eApp,
  registerConfirmAndLogin,
  resetThrottler,
} from './utils/e2e-app';

interface RenewPartsBody {
  parts: { part_number: number; url: string }[];
  expires_at: string;
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const DRAFT_SIZE_BYTES = 12 * 1024 * 1024; // 3 parts of 5 MiB
const DRAFT_PART_COUNT = 3;

describe('videos-uploads-renew-abort', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let ownerToken: string;
  let otherToken: string;
  let videoId: string;

  beforeAll(async () => {
    ({ app, moduleFixture } = await createE2eApp());
    dataSource = moduleFixture.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    resetThrottler(moduleFixture);
    ownerToken = await registerConfirmAndLogin(app, 'owner@example.com');
    otherToken = await registerConfirmAndLogin(app, 'other@example.com');
    const res = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        original_filename: 'draft.mp4',
        mime_type: 'video/mp4',
        size_bytes: DRAFT_SIZE_BYTES,
      })
      .expect(201);
    videoId = (res.body as { id: string }).id;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const renewParts = (
    id: string,
    partNumbers: number[],
    token: string | null,
  ) => {
    const req = request(app.getHttpServer()).post(
      `/videos/${id}/uploads/parts`,
    );
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send({ part_numbers: partNumbers });
  };

  const abort = (id: string, token: string | null) => {
    const req = request(app.getHttpServer()).delete(`/videos/${id}/uploads`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  const findVideo = () =>
    dataSource.getRepository(Video).findOneBy({ public_id: videoId });

  // 1. Renovar URLs de parte e abortar upload em rascunho

  test('renovar-partes-owner-draft-retorna-urls', async () => {
    const before = Date.now();

    const res = await renewParts(videoId, [1, 2], ownerToken).expect(200);

    const body = res.body as RenewPartsBody;
    expect(body.parts.map((part) => part.part_number)).toEqual([1, 2]);
    body.parts.forEach((part) => expect(part.url).toBeTruthy());
    const expiresInMs = new Date(body.expires_at).getTime() - before;
    expect(Math.abs(expiresInMs - SIX_HOURS_MS)).toBeLessThan(10_000);
  });

  test('renovar-partes-fora-do-intervalo-retorna-invalid-upload-parts', async () => {
    const res = await renewParts(
      videoId,
      [DRAFT_PART_COUNT + 1],
      ownerToken,
    ).expect(400);

    expect((res.body as ErrorBody).error).toBe('INVALID_UPLOAD_PARTS');
  });

  test('nao-owner-recebe-404-identico-a-inexistente', async () => {
    const otherRenew = await renewParts(videoId, [1], otherToken).expect(404);
    expect((otherRenew.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');

    const otherAbort = await abort(videoId, otherToken).expect(404);
    expect((otherAbort.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
    expect(await findVideo()).not.toBeNull();

    const unknownId = app.get(VideoPublicIdService).encode(999_999_999);
    const unknown = await renewParts(unknownId, [1], ownerToken).expect(404);
    expect(unknown.body).toEqual(otherRenew.body);
  });

  test('abortar-upload-owner-remove-rascunho', async () => {
    const res = await abort(videoId, ownerToken).expect(204);
    expect(res.text).toBe('');
    expect(await findVideo()).toBeNull();

    const again = await abort(videoId, ownerToken).expect(404);
    expect((again.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
  });

  test('abortar-upload-com-multipart-ja-removido-do-storage-remove-rascunho', async () => {
    const video = await findVideo();
    await moduleFixture.get<S3Client>(S3_INTERNAL_CLIENT).send(
      new AbortMultipartUploadCommand({
        Bucket: process.env.S3_BUCKET,
        Key: video!.storage_key,
        UploadId: video!.upload_id!,
      }),
    );

    const res = await abort(videoId, ownerToken).expect(204);
    expect(res.text).toBe('');
    expect(await findVideo()).toBeNull();
  });

  test('rotas-recusam-video-fora-de-draft', async () => {
    await dataSource
      .getRepository(Video)
      .update({ public_id: videoId }, { status: 'PROCESSING' });

    const renew = await renewParts(videoId, [1], ownerToken).expect(409);
    expect((renew.body as ErrorBody).error).toBe('VIDEO_NOT_IN_DRAFT');

    const aborted = await abort(videoId, ownerToken).expect(409);
    expect((aborted.body as ErrorBody).error).toBe('VIDEO_NOT_IN_DRAFT');
    expect((await findVideo())?.status).toBe('PROCESSING');
  });

  test('rotas-sem-token-retornam-401', async () => {
    await renewParts(videoId, [1], null).expect(401);
    await abort(videoId, null).expect(401);
  });
});
