import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/entities/user.entity';
import { Channel } from '../src/channels/entities/channel.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { StorageService } from '../src/videos/services/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { VideoProcessor } from '../src/videos/processors/video.processor';

describe('Videos Delivery (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storageService: StorageService;
  let video: Video;
  const videoContent = Buffer.from('0123456789'); // 10 bytes

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(VideoProcessor)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.enableShutdownHooks();
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    storageService = moduleFixture.get<StorageService>(StorageService);

    // 1. Clean DB
    await cleanAllTables(dataSource);

    // 2. Pre-seed User and Channel
    const userRepo = dataSource.getRepository(User);
    const channelRepo = dataSource.getRepository(Channel);
    const videoRepo = dataSource.getRepository(Video);

    const user = await userRepo.save(
      userRepo.create({
        email: 'delivery.test@example.com',
        password: 'hashed-password',
      }),
    );

    const channel = await channelRepo.save(
      channelRepo.create({
        name: 'Delivery Channel',
        nickname: 'delivery_chan',
        user_id: user.id,
      }),
    );

    // 3. Create Video in READY status
    const videoKey = 'videos/delivery-test-video/video.mp4';
    video = await videoRepo.save(
      videoRepo.create({
        title: 'Delivery E2E Test Movie',
        description: 'Test movie description',
        unique_url_id: 'deliver12345',
        status: VideoStatus.READY,
        video_key: videoKey,
        channel_id: channel.id,
        duration: 10,
        size_bytes: videoContent.length,
        mime_type: 'video/mp4',
      }),
    );

    // 4. Upload file content to MinIO
    await storageService.uploadBuffer(
      'videos',
      videoKey,
      videoContent,
      'video/mp4',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /videos/:unique_url_id', () => {
    it('should return video details publicly', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${video.unique_url_id}`)
        .expect(200);

      const body = res.body as Video;
      expect(body.id).toBe(video.id);
      expect(body.title).toBe(video.title);
      expect(body.status).toBe(VideoStatus.READY);
    });

    it('should return 404 for non-existent video details', async () => {
      await request(app.getHttpServer())
        .get('/videos/nonexistid12')
        .expect(404);
    });
  });

  describe('GET /videos/:unique_url_id/stream', () => {
    it('should stream full video when no Range header is sent', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${video.unique_url_id}/stream`)
        .expect(200);

      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.headers['content-length']).toBe(String(videoContent.length));
      expect((res.body as Buffer).toString()).toBe(videoContent.toString());
    });

    it('should return 206 Partial Content when Range header is sent', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${video.unique_url_id}/stream`)
        .set('Range', 'bytes=0-4')
        .expect(206);

      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.headers['content-length']).toBe('5');
      expect(res.headers['content-range']).toBe('bytes 0-4/10');
      expect((res.body as Buffer).toString()).toBe('01234'); // first 5 bytes
    });

    it('should return 400 if video is in DRAFT status', async () => {
      const videoRepo = dataSource.getRepository(Video);
      const draftVideo = await videoRepo.save(
        videoRepo.create({
          title: 'Draft Movie',
          unique_url_id: 'draftmovie12',
          status: VideoStatus.DRAFT,
          video_key: 'videos/draft/video.mp4',
          channel_id: video.channel_id,
        }),
      );

      await request(app.getHttpServer())
        .get(`/videos/${draftVideo.unique_url_id}/stream`)
        .expect(400);
    });
  });

  describe('GET /videos/:unique_url_id/download', () => {
    it('should download complete file as attachment', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${video.unique_url_id}/download`)
        .expect(200);

      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="${video.title}.mp4"`,
      );
      expect((res.body as Buffer).toString()).toBe(videoContent.toString());
    });
  });
});
