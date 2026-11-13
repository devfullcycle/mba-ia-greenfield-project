import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'minio';
import { DataSource, Repository } from 'typeorm';
import { Channel } from './channels/entities/channel.entity';
import {
  createWorkerDataSource,
  createWorkerStorageClient,
  VideoProcessor,
  workerBucket,
} from './video-processor';
import { User } from './users/entities/user.entity';
import { cleanAllTables } from './test/create-test-data-source';
import { Video } from './videos/entities/video.entity';
import { VideoStatus } from './videos/enums/video-status.enum';

const execFileAsync = promisify(execFile);

describe('VideoProcessor (integration)', () => {
  let dataSource: DataSource;
  let client: Client;
  let processor: VideoProcessor;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let counter = 0;

  beforeAll(async () => {
    dataSource = createWorkerDataSource();
    await dataSource.initialize();
    client = createWorkerStorageClient();
    await client.makeBucket(workerBucket()).catch(() => undefined);
    processor = new VideoProcessor(dataSource, client, workerBucket());
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  it('processes a real video with ffprobe/ffmpeg and stores a thumbnail', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'streamtube-processor-'));
    const sourcePath = `${workspace}/fixture.mp4`;
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=320x240:d=2',
        '-pix_fmt',
        'yuv420p',
        sourcePath,
      ]);
      const sourceKey = `videos/integration-${Date.now()}/source`;
      await client.fPutObject(workerBucket(), sourceKey, sourcePath, {
        'Content-Type': 'video/mp4',
      });

      const user = await userRepository.save(
        userRepository.create({
          email: `processor-${++counter}@example.com`,
          password: 'hashed',
        }),
      );
      const channel = await channelRepository.save(
        channelRepository.create({
          name: `Processor ${counter}`,
          nickname: `processor-${counter}`,
          user_id: user.id,
        }),
      );
      const video = await videoRepository.save(
        videoRepository.create({
          channel_id: channel.id,
          status: VideoStatus.PROCESSING,
          storage_key: sourceKey,
          mime_type: 'video/mp4',
        }),
      );

      await expect(
        processor.process({
          videoId: video.id,
          storageKey: sourceKey,
          mimeType: 'video/mp4',
        }),
      ).resolves.toEqual({ videoId: video.id, status: VideoStatus.READY });

      const processed = await videoRepository.findOneByOrFail({ id: video.id });
      expect(processed.status).toBe(VideoStatus.READY);
      expect(Number(processed.duration_seconds)).toBeGreaterThan(0);
      expect(processed.thumbnail_key).toContain('/thumbnail.jpg');
      await expect(
        client.statObject(workerBucket(), processed.thumbnail_key!),
      ).resolves.toEqual(expect.objectContaining({ size: expect.any(Number) }));
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 30_000);
});
