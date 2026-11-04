import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import storageConfig from '../../config/storage.config';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { PROCESS_VIDEO_JOB } from '../videos.service';
import { MediaProbeService } from './media-probe.service';
import { VideoProcessor } from './video.processor';

const execFileAsync = promisify(execFile);

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('VideoProcessor & MediaProbeService (integration — FFmpeg + MinIO + PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let processor: VideoProcessor;
  let storageService: StorageService;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    const ds = createTestDataSource([User, Channel, Video]);

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
        }),
        TypeOrmModule.forRoot(ds.options),
        TypeOrmModule.forFeature([User, Channel, Video]),
        StorageModule,
      ],
      providers: [MediaProbeService, VideoProcessor],
    }).compile();

    await moduleRef.init();

    dataSource = moduleRef.get(DataSource);
    processor = moduleRef.get(VideoProcessor);
    storageService = moduleRef.get(StorageService);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  it('extracts real video duration/dimensions via ffprobe and generates a valid JPEG thumbnail in MinIO via ffmpeg', async () => {
    // 1. Generate a real 2-second 320x240 MP4 video using ffmpeg
    const tempSampleMp4 = join(
      tmpdir(),
      `sample-integration-${Date.now()}.mp4`,
    );
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=320x240:rate=15',
      '-pix_fmt',
      'yuv420p',
      tempSampleMp4,
    ]);

    const mp4Buffer = await readFile(tempSampleMp4);
    await unlink(tempSampleMp4).catch(() => undefined);

    // 2. Create user, channel, and processing video row
    const user = await userRepository.save(
      userRepository.create({
        email: 'worker_test@example.com',
        password: 'hashed_password',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'worker_channel',
        nickname: 'worker_channel',
        user_id: user.id,
      }),
    );

    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        slug: 'WorkerSlug1',
        title: 'Real FFmpeg Integration Video',
        status: VideoStatus.PROCESSING,
        storage_key: `videos/worker-test-${Date.now()}/original.mp4`,
        original_filename: 'sample.mp4',
        mime_type: 'video/mp4',
        size_bytes: mp4Buffer.length,
      }),
    );

    // 3. Upload raw MP4 to MinIO
    await storageService.putObject(video.storage_key, mp4Buffer, 'video/mp4');

    // 4. Execute VideoProcessor
    await processor.process({
      id: `video-${video.id}`,
      name: PROCESS_VIDEO_JOB,
      data: {
        videoId: video.id,
        storageKey: video.storage_key,
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    // 5. Verify DB state
    const processed = await videoRepository.findOneBy({ id: video.id });
    expect(processed).not.toBeNull();
    expect(processed!.status).toBe(VideoStatus.READY);
    expect(processed!.duration_seconds).toBe(2);
    expect(processed!.width).toBe(320);
    expect(processed!.height).toBe(240);
    expect(processed!.codec).toBeTruthy();
    expect(processed!.thumbnail_key).toBe(`thumbnails/${video.id}/thumb.jpg`);
    expect(processed!.processing_error).toBeNull();

    // 6. Verify thumbnail exists in MinIO and has JPEG magic bytes (FF D8 FF)
    const thumbStream = await storageService.getObjectStream(
      processed!.thumbnail_key!,
    );
    const thumbBytes = await streamToBuffer(thumbStream.stream);
    expect(thumbBytes.length).toBeGreaterThan(100);
    expect(thumbBytes[0]).toBe(0xff);
    expect(thumbBytes[1]).toBe(0xd8);
    expect(thumbBytes[2]).toBe(0xff);

    // Cleanup MinIO objects
    await storageService.deleteObject(video.storage_key);
    await storageService.deleteObject(processed!.thumbnail_key!);
  });
});
