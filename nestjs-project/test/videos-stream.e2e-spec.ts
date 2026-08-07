import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { StorageService } from '../src/storage/storage.service';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/video-status';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('Videos stream/download/read (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let videos: Repository<Video>;
  let channelId: string;

  const CONTENT = Buffer.from('0123456789ABCDEF');

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
    storage = moduleFixture.get(StorageService);
    videos = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);

    const ts = Date.now();
    const [{ id: userId }] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id`,
      [`viewer-${ts}@test.local`, 'x'],
    );
    const [{ id }] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO channels (name, nickname, user_id) VALUES ($1, $2, $3) RETURNING id`,
      ['Viewer Channel', `viewer_${ts}`, userId],
    );
    channelId = id;
  });

  async function seedReadyVideo(): Promise<Video> {
    const publicId = `ready${Date.now().toString(36)}`;
    const storageKey = `videos/${publicId}/source`;
    await storage.putObject(storageKey, CONTENT, 'video/mp4');
    return videos.save(
      videos.create({
        public_id: publicId,
        channel_id: channelId,
        title: 'Ready clip',
        content_type: 'video/mp4',
        storage_key: storageKey,
        size_bytes: CONTENT.length,
        duration_seconds: 1,
        status: VideoStatus.READY,
      }),
    );
  }

  it('returns metadata for a ready video', async () => {
    const video = await seedReadyVideo();
    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}`)
      .expect(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.title).toBe('Ready clip');
    expect(res.body.channel.nickname).toContain('viewer_');
  });

  it('returns 404 for an unknown video', async () => {
    await request(app.getHttpServer())
      .get('/videos/does-not-exist')
      .expect(404);
  });

  it('streams a byte range with 206 Partial Content', async () => {
    const video = await seedReadyVideo();
    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/stream`)
      .set('Range', 'bytes=0-4')
      .expect(206);
    expect(res.headers['content-range']).toBe('bytes 0-4/16');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe('5');
  });

  it('streams the full object with 200 when no Range is sent', async () => {
    const video = await seedReadyVideo();
    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/stream`)
      .expect(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe('16');
  });

  it('redirects to a presigned URL on download', async () => {
    const video = await seedReadyVideo();
    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/download`)
      .redirects(0)
      .expect(302);
    expect(res.headers.location).toContain(`videos/${video.public_id}/source`);
    expect(res.headers.location).toContain('X-Amz-Signature');
  });

  it('returns 404 when streaming a non-ready video', async () => {
    const draft = await videos.save(
      videos.create({
        public_id: `draft${Date.now().toString(36)}`,
        channel_id: channelId,
        title: 'Draft',
        content_type: 'video/mp4',
        storage_key: 'videos/x/source',
        status: VideoStatus.DRAFT,
      }),
    );
    await request(app.getHttpServer())
      .get(`/videos/${draft.public_id}/stream`)
      .expect(404);
  });
});
