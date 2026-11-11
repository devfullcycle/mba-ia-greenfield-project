import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request, { type Response } from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import type { Video } from '../src/videos/entities/video.entity';
import {
  createE2eApp,
  registerConfirmAndLogin,
  resetThrottler,
} from './utils/e2e-app';
import { channelOf, seedVideo } from './utils/video-seed';

const OWNER_EMAIL = 'owner@example.com';
const ORIGINAL_FILENAME = 'vídeo "férias".mp4';
const VIDEO_SIZE = 8 * 1024;

/** Collects the raw body as a Buffer regardless of content type. */
const binary = (
  res: Response,
  done: (err: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('videos-media', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let ownerToken: string;
  let ready: Video;
  let processing: Video;
  let videoContent: Buffer;
  let thumbnailContent: Buffer;
  const collected: Response[] = [];

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
    ownerToken = await registerConfirmAndLogin(app, OWNER_EMAIL);
    const channel = await channelOf(app, OWNER_EMAIL);
    ready = await seedVideo(app, channel.id, 'READY', {
      original_filename: ORIGINAL_FILENAME,
      size_bytes: VIDEO_SIZE,
    });
    processing = await seedVideo(app, channel.id, 'PROCESSING');

    videoContent = randomBytes(VIDEO_SIZE);
    thumbnailContent = randomBytes(512);
    const storage = app.get(StorageService);
    await storage.putObject(ready.storage_key, videoContent, 'video/mp4');
    await storage.putObject(
      ready.thumbnail_key!,
      thumbnailContent,
      'image/jpeg',
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const get = async (
    path: string,
    headers: Record<string, string> = {},
  ): Promise<Response> => {
    const res = await request(app.getHttpServer())
      .get(path)
      .set(headers)
      .buffer(true)
      .parse(binary);
    collected.push(res);
    return res;
  };

  const errorOf = (res: Response): string =>
    (JSON.parse((res.body as Buffer).toString('utf8')) as { error: string })
      .error;

  // 1. Entregar stream, download e thumbnail de vídeos prontos

  test('stream-com-range-retorna-206-parcial', async () => {
    const res = await get(`/videos/${ready.public_id}/stream`, {
      Range: 'bytes=0-1023',
    });

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-1023/${VIDEO_SIZE}`);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect((res.body as Buffer).equals(videoContent.subarray(0, 1024))).toBe(
      true,
    );
  });

  test('stream-sem-range-retorna-200-completo', async () => {
    const res = await get(`/videos/${ready.public_id}/stream`);

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(VIDEO_SIZE));
    expect(res.headers['content-type']).toMatch(/^video\/mp4/);
    expect((res.body as Buffer).length).toBe(VIDEO_SIZE);
  });

  test('download-com-content-disposition-codificado', async () => {
    const full = await get(`/videos/${ready.public_id}/download`);

    expect(full.status).toBe(200);
    const disposition = full.headers['content-disposition'];
    expect(disposition.startsWith('attachment')).toBe(true);
    const fallback = /filename="([^"]*)"/.exec(disposition)?.[1];
    expect(fallback).toBeDefined();
    expect(fallback).toMatch(/^[\x20-\x7e]*$/);
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent(ORIGINAL_FILENAME)}`,
    );

    const partial = await get(`/videos/${ready.public_id}/download`, {
      Range: 'bytes=0-99',
    });
    expect(partial.status).toBe(206);
    expect(partial.headers['content-range']).toBe(`bytes 0-99/${VIDEO_SIZE}`);
    expect((partial.body as Buffer).length).toBe(100);
  });

  test('stream-range-alem-do-tamanho-retorna-416', async () => {
    const res = await get(`/videos/${ready.public_id}/stream`, {
      Range: `bytes=${VIDEO_SIZE}-`,
    });

    expect(res.status).toBe(416);
    expect(errorOf(res)).toBe('RANGE_NOT_SATISFIABLE');
    expect(res.headers['content-range']).toBe(`bytes */${VIDEO_SIZE}`);
  });

  test('thumbnail-de-video-ready-retorna-jpeg', async () => {
    const res = await get(`/videos/${ready.public_id}/thumbnail`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
    expect((res.body as Buffer).equals(thumbnailContent)).toBe(true);
  });

  test('midia-de-video-nao-ready-retorna-404-inclusive-owner', async () => {
    const asAnonymous: Record<string, string> = {};
    const asOwner = { Authorization: `Bearer ${ownerToken}` };
    for (const auth of [asAnonymous, asOwner]) {
      for (const route of ['stream', 'download', 'thumbnail']) {
        const res = await get(`/videos/${processing.public_id}/${route}`, auth);
        expect(res.status).toBe(404);
        expect(errorOf(res)).toBe('VIDEO_NOT_FOUND');
      }
    }
  });

  test('respostas-nao-expoem-host-do-minio', () => {
    // Relies on the responses collected by the previous scenarios in this file.
    expect(collected.length).toBeGreaterThan(0);
    const forbidden = [
      'minio',
      'X-Amz-',
      process.env.S3_ENDPOINT,
      process.env.S3_PUBLIC_ENDPOINT,
    ].filter((value): value is string => Boolean(value));

    for (const res of collected) {
      expect(res.status < 300 || res.status >= 400).toBe(true);
      const headerText = JSON.stringify(res.headers);
      const errorBody =
        res.status >= 400 ? (res.body as Buffer).toString('utf8') : '';
      for (const value of forbidden) {
        expect(headerText).not.toContain(value);
        expect(errorBody).not.toContain(value);
      }
    }
  });
});
