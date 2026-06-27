import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { StorageService } from '../src/storage/storage.service';
import { Channel } from '../src/channels/entities/channel.entity';
import { Video } from '../src/videos/entities/video.entity';
import { storageKey, VideoStatus } from '../src/videos/videos.constants';
import { cleanAllTables } from '../src/test/create-test-data-source';

const PAYLOAD = Buffer.from('0123456789'); // 10 bytes
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

// supertest/superagent does not buffer non-text bodies by default — collect the
// raw bytes so we can assert on binary responses (video, jpeg).
function binaryParser(
  res: any,
  callback: (err: Error | null, body: Buffer) => void,
): void {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk: string) => {
    data += chunk;
  });
  res.on('end', () => {
    callback(null, Buffer.from(data, 'binary'));
  });
}

describe('Videos delivery (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let channels: Repository<Channel>;
  let storage: StorageService;

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
    videos = dataSource.getRepository(Video);
    channels = dataSource.getRepository(Channel);
    storage = moduleFixture.get(StorageService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
  });

  async function createChannel(email: string): Promise<string> {
    const authService = app.get(AuthService);
    const mailService = (authService as any).mailService;
    jest
      .spyOn(mailService, 'sendConfirmationEmail')
      .mockResolvedValueOnce(undefined);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'password123' });
    const channel = await channels.findOneByOrFail({});
    return channel.id;
  }

  async function seedReadyVideo(): Promise<string> {
    const channelId = await createChannel(`viewer-${Date.now()}@example.com`);
    const video = await videos.save(
      videos.create({
        public_id: `pub-${Date.now()}`,
        channel_id: channelId,
        title: 'A ready video',
        status: VideoStatus.READY,
        original_filename: 'clip.mp4',
        duration_seconds: 2,
      }),
    );
    const objectKey = storageKey.original(video.id, 'clip.mp4');
    const thumbKey = storageKey.thumbnail(video.id);
    await storage.putObject(objectKey, PAYLOAD, 'video/mp4');
    await storage.putObject(thumbKey, JPEG, 'image/jpeg');
    video.storage_key = objectKey;
    video.thumbnail_key = thumbKey;
    await videos.save(video);
    return video.public_id;
  }

  it('streams a ready video with 206 Partial Content for a Range request', async () => {
    const publicId = await seedReadyVideo();

    const res = await request(app.getHttpServer())
      .get(`/videos/${publicId}/stream`)
      .set('Range', 'bytes=0-4')
      .buffer()
      .parse(binaryParser)
      .expect(206);

    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-range']).toContain('bytes 0-4/10');
    expect((res.body as Buffer).toString()).toBe('01234');
  }, 30000);

  it('streams the full body with 200 when no Range header is sent', async () => {
    const publicId = await seedReadyVideo();

    const res = await request(app.getHttpServer())
      .get(`/videos/${publicId}/stream`)
      .buffer()
      .parse(binaryParser)
      .expect(200);

    expect(res.headers['accept-ranges']).toBe('bytes');
    expect((res.body as Buffer).toString()).toBe('0123456789');
  }, 30000);

  it('downloads the original file as an attachment', async () => {
    const publicId = await seedReadyVideo();

    const res = await request(app.getHttpServer())
      .get(`/videos/${publicId}/download`)
      .buffer()
      .parse(binaryParser)
      .expect(200);

    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('clip.mp4');
    expect((res.body as Buffer).toString()).toBe('0123456789');
  }, 30000);

  it('serves the JPEG thumbnail', async () => {
    const publicId = await seedReadyVideo();

    const res = await request(app.getHttpServer())
      .get(`/videos/${publicId}/thumbnail`)
      .buffer()
      .parse(binaryParser)
      .expect(200);

    expect(res.headers['content-type']).toContain('image/jpeg');
    expect((res.body as Buffer).equals(JPEG)).toBe(true);
  }, 30000);

  it('allows an anonymous user to stream a ready video', async () => {
    const publicId = await seedReadyVideo();

    await request(app.getHttpServer())
      .get(`/videos/${publicId}/stream`)
      .expect(200);
  }, 30000);

  it('returns 409 when streaming a video that is not ready', async () => {
    const channelId = await createChannel('notready@example.com');
    const video = await videos.save(
      videos.create({
        public_id: 'pub-processing',
        channel_id: channelId,
        title: 'Still processing',
        status: VideoStatus.PROCESSING,
      }),
    );

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/stream`)
      .expect(409);
    expect(res.body.error).toBe('VIDEO_NOT_READY');
  }, 30000);

  it('returns 404 when streaming an unknown video', async () => {
    const res = await request(app.getHttpServer())
      .get('/videos/does-not-exist/stream')
      .expect(404);
    expect(res.body.error).toBe('VIDEO_NOT_FOUND');
  }, 30000);
});
