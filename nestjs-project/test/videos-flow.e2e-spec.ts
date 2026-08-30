import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('Videos full flow (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let fixtureBuffer: Buffer;
  let workDir: string;

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'e2e-fixture-'));
    const fixturePath = join(workDir, 'fixture.mp4');
    execFileSync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=320x240:rate=5',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:duration=2',
      '-shortest',
      '-pix_fmt',
      'yuv420p',
      fixturePath,
    ]);
    fixtureBuffer = readFileSync(fixturePath);

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
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  }, 30000);

  afterAll(async () => {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function registerConfirmAndLogin(): Promise<string> {
    const email = `videos_flow_${Date.now()}@example.com`;
    const password = 'password123';

    const authService = app.get(AuthService);
    const mailServiceInstance = (authService as any).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce((_e: string, _n: string, t: string) => {
        capturedToken = t;
        return Promise.resolve();
      });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return res.body.access_token;
  }

  it('completes the full upload -> processing -> playback flow', async () => {
    const token = await registerConfirmAndLogin();

    const initiateRes = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        original_filename: 'fixture.mp4',
        content_type: 'video/mp4',
        size_bytes: fixtureBuffer.length,
      });
    expect(initiateRes.status).toBe(201);
    const { id: publicId, parts } = initiateRes.body;

    const putResponse = await fetch(parts[0].url, {
      method: 'PUT',
      body: new Blob([Uint8Array.from(fixtureBuffer)]),
    });
    expect(putResponse.status).toBe(200);
    const etag = putResponse.headers.get('etag')!;

    const completeRes = await request(app.getHttpServer())
      .post(`/videos/${publicId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ part_number: 1, etag }] });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe('processando');

    let status = 'processando';
    let durationSeconds: number | null = null;
    for (let i = 0; i < 30 && status === 'processando'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const getRes = await request(app.getHttpServer())
        .get(`/videos/${publicId}`)
        .set('Authorization', `Bearer ${token}`);
      status = getRes.body.status;
      durationSeconds = getRes.body.duration_seconds;
    }

    expect(status).toBe('pronto');
    expect(durationSeconds).toBe(2);

    const streamRes = await request(app.getHttpServer()).get(
      `/videos/${publicId}/stream`,
    );
    expect(streamRes.status).toBe(302);
    expect(streamRes.headers.location).toBeTruthy();

    const downloadRes = await request(app.getHttpServer()).get(
      `/videos/${publicId}/download`,
    );
    expect(downloadRes.status).toBe(302);
    expect(decodeURIComponent(downloadRes.headers.location)).toContain(
      'attachment',
    );
  }, 60000);
});
