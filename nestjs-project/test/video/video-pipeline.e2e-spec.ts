import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { statSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { VIDEO_PROCESSING_QUEUE } from '../../src/queue/queue.constants';
import { cleanAllTables } from '../../src/test/create-test-data-source';
import {
  clearMailpitMessages,
  getMailpitMessage,
  getMailpitMessages,
} from '../../src/test/mailpit';
import {
  createHttpApi,
  createPartPutter,
  uploadFile,
} from '../../src/upload-client/multipart-uploader';
import { WorkerModule } from '../../src/worker.module';
import { createE2eApp, resetThrottler } from '../utils/e2e-app';

jest.setTimeout(120_000);

const FIXTURES = join(__dirname, 'fixtures');
const EMAIL = 'pipeline@example.com';
const PASSWORD = 'password123';
const POLL_INTERVAL_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('video-pipeline', () => {
  let api: INestApplication;
  let apiFixture: TestingModule;
  let worker: TestingModule;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    ({ app: api, moduleFixture: apiFixture } = await createE2eApp());
    await api.listen(0);
    baseUrl = await api.getUrl();

    worker = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await worker.init(); // starts the BullMQ consumer in this process
  });

  afterAll(async () => {
    await worker?.close();
    await api?.close();
  });

  beforeEach(async () => {
    await worker
      .get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE))
      .obliterate({ force: true });
    await cleanAllTables(apiFixture.get(DataSource));
    await clearMailpitMessages();
    resetThrottler(apiFixture);
    token = await registerViaMailpit();
  });

  async function http(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, init);
  }

  /** Real sign-up flow: the confirmation token is read from the email in Mailpit. */
  async function registerViaMailpit(): Promise<string> {
    const register = await http('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(register.status).toBe(201);

    let messageId: string | undefined;
    while (!messageId) {
      messageId = (await getMailpitMessages()).find((message) =>
        message.To.some((to) => to.Address === EMAIL),
      )?.ID;
      if (!messageId) await sleep(POLL_INTERVAL_MS);
    }
    const { HTML } = await getMailpitMessage(messageId);
    const confirmationToken = /token=([\w-]+)/.exec(HTML)?.[1];
    expect(confirmationToken).toBeDefined();

    const confirm = await http(
      `/auth/confirm-email?token=${confirmationToken}`,
    );
    expect(confirm.status).toBe(204);

    const login = await http('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    return ((await login.json()) as { access_token: string }).access_token;
  }

  async function uploadFixture(fixture: string): Promise<string> {
    const filePath = join(FIXTURES, fixture);
    const result = await uploadFile({
      filePath,
      filename: fixture,
      mimeType: 'video/mp4',
      sizeBytes: statSync(filePath).size,
      api: createHttpApi(baseUrl, token),
      putPart: createPartPutter(),
    });
    expect(result.status).toBe('PROCESSING');
    return result.id;
  }

  async function waitUntilSettled(publicId: string): Promise<string> {
    for (;;) {
      const res = await http(`/videos/${publicId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { status } = (await res.json()) as { status: string };
      if (status !== 'PROCESSING') return status;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  test('fixture-valida-fica-ready-e-e-reproduzivel', async () => {
    const size = statSync(join(FIXTURES, 'sample.mp4')).size;
    const publicId = await uploadFixture('sample.mp4');

    expect(await waitUntilSettled(publicId)).toBe('READY');

    const stream = await http(`/videos/${publicId}/stream`, {
      headers: { Range: 'bytes=0-1023' },
    });
    expect(stream.status).toBe(206);
    expect(stream.headers.get('content-range')).toBe(`bytes 0-1023/${size}`);
    expect((await stream.arrayBuffer()).byteLength).toBe(1024);

    const download = await http(`/videos/${publicId}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toMatch(/^attachment/);
    expect((await download.arrayBuffer()).byteLength).toBe(size);

    const thumbnail = await http(`/videos/${publicId}/thumbnail`);
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get('content-type')).toMatch(/^image\/jpeg/);
    expect((await thumbnail.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test('fixture-falsa-termina-em-error-e-nao-e-reproduzivel', async () => {
    const publicId = await uploadFixture('fake.mp4');

    expect(await waitUntilSettled(publicId)).toBe('ERROR');

    const stream = await http(`/videos/${publicId}/stream`);
    expect(stream.status).toBe(404);
    expect(((await stream.json()) as { error: string }).error).toBe(
      'VIDEO_NOT_FOUND',
    );
  });
});
