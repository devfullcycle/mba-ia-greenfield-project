import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Channel } from '../src/channels/entities/channel.entity';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import {
  createE2eApp,
  registerConfirmAndLogin,
  resetThrottler,
} from './utils/e2e-app';

interface InitiateUploadBody {
  id: string;
  status: string;
  part_size: number;
  part_count: number;
  parts: { part_number: number; url: string }[];
  expires_at: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TEN_GB = 10_737_418_240;
const USER_EMAIL = 'uploader@example.com';

describe('videos-uploads', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let accessToken: string;

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
    accessToken = await registerConfirmAndLogin(app, USER_EMAIL);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const initiate = (body: object, token: string | null = accessToken) => {
    const req = request(app.getHttpServer()).post('/videos/uploads');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };

  // 1. Iniciar upload multipart e pré-cadastrar vídeo em rascunho

  test('iniciar-upload-10gb-retorna-draft-com-urls', async () => {
    const before = Date.now();

    const res = await initiate({
      original_filename: 'a.mp4',
      mime_type: 'video/mp4',
      size_bytes: TEN_GB,
    }).expect(201);

    const body = res.body as InitiateUploadBody;
    expect(body.status).toBe('DRAFT');
    expect(body.part_size).toBeLessThanOrEqual(104_857_600);
    expect(body.part_count).toBeLessThanOrEqual(10_000);
    expect(body.parts).toHaveLength(body.part_count);
    body.parts.forEach((part, index) => {
      expect(part.part_number).toBe(index + 1);
      expect(part.url).toBeTruthy();
    });
    const expiresInMs = new Date(body.expires_at).getTime() - before;
    expect(Math.abs(expiresInMs - SIX_HOURS_MS)).toBeLessThan(10_000);
    expect(body.id.length).toBeGreaterThanOrEqual(10);
    expect(body.id).not.toMatch(UUID_PATTERN);

    const user = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email: USER_EMAIL });
    const channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: user.id });
    const videos = await dataSource.getRepository(Video).find();
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      status: 'DRAFT',
      channel_id: channel.id,
      title: 'a.mp4',
      public_id: body.id,
    });
    expect(videos[0].upload_id).toBeTruthy();
  });

  test('iniciar-upload-validacao-rejeita-body-invalido', async () => {
    const pdf = await initiate({
      original_filename: 'a.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
    }).expect(400);
    expect((pdf.body as { error: string }).error).toBe('VALIDATION_ERROR');

    const tooLarge = await initiate({
      original_filename: 'a.mp4',
      mime_type: 'video/mp4',
      size_bytes: TEN_GB + 1,
    }).expect(400);
    expect((tooLarge.body as { error: string }).error).toBe('VALIDATION_ERROR');

    expect(await dataSource.getRepository(Video).count()).toBe(0);
  });

  test('iniciar-upload-sem-token-retorna-401', async () => {
    await initiate(
      { original_filename: 'a.mp4', mime_type: 'video/mp4', size_bytes: 1024 },
      null,
    ).expect(401);

    expect(await dataSource.getRepository(Video).count()).toBe(0);
  });

  test('iniciar-upload-isento-do-throttler', async () => {
    for (let call = 0; call < 15; call++) {
      const res = await initiate({
        original_filename: `clip-${call}.mp4`,
        mime_type: 'video/mp4',
        size_bytes: 1024,
      });
      expect(res.status).toBe(201);
    }
  });
});
