import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import type { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { VideoPublicIdService } from '../src/videos/video-public-id.service';
import {
  createE2eApp,
  registerConfirmAndLogin,
  resetThrottler,
} from './utils/e2e-app';
import { channelOf, seedVideo } from './utils/video-seed';

interface VideoBody {
  id: string;
  status: VideoStatus;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  stream_url: string | null;
  download_url: string | null;
  thumbnail_url: string | null;
}

const OWNER_EMAIL = 'owner@example.com';
const HIDDEN_STATUSES: VideoStatus[] = ['DRAFT', 'PROCESSING', 'ERROR'];

describe('videos-metadata', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let ownerToken: string;
  let otherToken: string;
  let videos: Record<VideoStatus, Video>;

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
    otherToken = await registerConfirmAndLogin(app, 'other@example.com');
    const channel = await channelOf(app, OWNER_EMAIL);
    videos = {
      READY: await seedVideo(app, channel.id, 'READY'),
      DRAFT: await seedVideo(app, channel.id, 'DRAFT'),
      PROCESSING: await seedVideo(app, channel.id, 'PROCESSING'),
      ERROR: await seedVideo(app, channel.id, 'ERROR'),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const getVideo = (publicId: string, authorization?: string) => {
    const req = request(app.getHttpServer()).get(`/videos/${publicId}`);
    if (authorization) req.set('Authorization', authorization);
    return req;
  };

  // 1. Consultar metadados do vídeo com autenticação opcional

  test('anonimo-ve-video-ready-com-urls-de-midia', async () => {
    const { public_id } = videos.READY;

    const res = await getVideo(public_id).expect(200);

    const body = res.body as VideoBody;
    expect(body.duration_seconds).toBeGreaterThan(0);
    expect(body.width).toBe(640);
    expect(body.height).toBe(360);
    expect(body.codec).toBe('h264');
    expect(body.stream_url).toBe(`/videos/${public_id}/stream`);
    expect(body.download_url).toBe(`/videos/${public_id}/download`);
    expect(body.thumbnail_url).toBe(`/videos/${public_id}/thumbnail`);
  });

  test('video-oculto-retorna-404-para-anonimo-e-nao-owner', async () => {
    const bodies: unknown[] = [];
    for (const status of HIDDEN_STATUSES) {
      const anonymous = await getVideo(videos[status].public_id).expect(404);
      const other = await getVideo(
        videos[status].public_id,
        `Bearer ${otherToken}`,
      ).expect(404);
      bodies.push(anonymous.body, other.body);
    }
    bodies.forEach((body) =>
      expect((body as { error: string }).error).toBe('VIDEO_NOT_FOUND'),
    );

    const unknownId = app.get(VideoPublicIdService).encode(999_999_999);
    const unknown = await getVideo(unknownId).expect(404);
    bodies.forEach((body) => expect(body).toEqual(unknown.body));
  });

  test('owner-ve-video-processing-sem-urls', async () => {
    const res = await getVideo(
      videos.PROCESSING.public_id,
      `Bearer ${ownerToken}`,
    ).expect(200);

    const body = res.body as VideoBody;
    expect(body.status).toBe('PROCESSING');
    expect(body.stream_url).toBeNull();
    expect(body.download_url).toBeNull();
    expect(body.thumbnail_url).toBeNull();
  });

  test('token-invalido-tratado-como-anonimo', async () => {
    const res = await getVideo(
      videos.READY.public_id,
      'Bearer invalido',
    ).expect(200);

    expect((res.body as VideoBody).status).toBe('READY');
  });

  test('resposta-nao-expoe-campos-internos', async () => {
    const responses = [
      { video: videos.READY, res: await getVideo(videos.READY.public_id) },
      {
        video: videos.PROCESSING,
        res: await getVideo(
          videos.PROCESSING.public_id,
          `Bearer ${ownerToken}`,
        ),
      },
    ];

    for (const { video, res } of responses) {
      const body = res.body as VideoBody;
      const serialized = JSON.stringify(body);
      expect(body.id).toBe(video.public_id);
      expect(body.id).not.toBe(video.id);
      expect(serialized).not.toContain(video.id);
      for (const key of ['storage_key', 'upload_id', 'seq', 'thumbnail_key']) {
        expect(body).not.toHaveProperty(key);
      }
    }
  });

  test('leitura-anonima-isenta-do-throttler', async () => {
    for (let call = 0; call < 20; call++) {
      const res = await getVideo(videos.READY.public_id);
      expect(res.status).toBe(200);
    }
  });
});
