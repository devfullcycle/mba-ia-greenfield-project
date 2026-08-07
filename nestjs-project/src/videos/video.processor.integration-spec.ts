import { Test, type TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { cleanAllTables } from '../test/create-test-data-source';
import { StorageService } from '../storage/storage.service';
import type { ProcessVideoJobData } from '../queue/video-jobs';
import { Video } from './entities/video.entity';
import { VideoProcessor } from './video.processor';
import { VideoStatus } from './video-status';
import { WorkerModule } from '../worker.module';

async function generateTestVideo(path: string): Promise<Buffer> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=128x72:rate=10',
      '-pix_fmt',
      'yuv420p',
      '-y',
      path,
    ]);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg gen failed (${code})`)),
    );
  });
  return readFile(path);
}

/**
 * Exercises the worker's processing logic against real ffmpeg + MinIO + Postgres.
 * The processor is driven directly (process/onFailed) for determinism; the queue
 * delivery hop is covered by the producer integration test and the upload e2e.
 */
describe('VideoProcessor (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let storage: StorageService;
  let processor: VideoProcessor;
  let channelId: string;

  beforeAll(async () => {
    // compile() (not init()) so the BullMQ worker is NOT auto-started; we call
    // the processor methods directly.
    moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    videos = dataSource.getRepository(Video);
    storage = moduleRef.get(StorageService);
    processor = moduleRef.get(VideoProcessor);
    await storage.ensureBucket();
  }, 60000);

  afterAll(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);

    const ts = Date.now();
    const [{ id: userId }] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id`,
      [`proc-${ts}@test.local`, 'x'],
    );
    const [{ id }] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO channels (name, nickname, user_id) VALUES ($1, $2, $3) RETURNING id`,
      ['Proc Channel', `proc_${ts}`, userId],
    );
    channelId = id;
  });

  function fakeJob(videoId: string): Job<ProcessVideoJobData> {
    return { data: { videoId } } as unknown as Job<ProcessVideoJobData>;
  }

  it('processes a valid video to ready with duration + thumbnail', async () => {
    const publicId = `proc${Date.now().toString(36)}`;
    const storageKey = `videos/${publicId}/source`;
    const path = join(tmpdir(), `${publicId}.mp4`);
    const buffer = await generateTestVideo(path);
    await storage.putObject(storageKey, buffer, 'video/mp4');
    await unlink(path).catch(() => undefined);

    const video = await videos.save(
      videos.create({
        public_id: publicId,
        channel_id: channelId,
        title: 'proc',
        content_type: 'video/mp4',
        storage_key: storageKey,
        status: VideoStatus.PROCESSING,
      }),
    );

    await processor.process(fakeJob(video.id));

    const ready = await videos.findOneByOrFail({ id: video.id });
    expect(ready.status).toBe(VideoStatus.READY);
    expect(ready.duration_seconds).toBeGreaterThanOrEqual(1);
    expect(ready.thumbnail_key).toBe(`videos/${publicId}/thumbnail.jpg`);
    expect(ready.metadata).toMatchObject({ codec: expect.any(String) });
    expect(await storage.objectExists(ready.thumbnail_key as string)).toBe(
      true,
    );
  }, 60000);

  it('marks the video as error when the source is not processable', async () => {
    const publicId = `err${Date.now().toString(36)}`;
    const storageKey = `videos/${publicId}/source`;
    await storage.putObject(
      storageKey,
      Buffer.from('this is not a video'),
      'video/mp4',
    );

    const video = await videos.save(
      videos.create({
        public_id: publicId,
        channel_id: channelId,
        title: 'bad',
        content_type: 'video/mp4',
        storage_key: storageKey,
        status: VideoStatus.PROCESSING,
      }),
    );

    // processing throws (ffprobe rejects the garbage source)
    await expect(processor.process(fakeJob(video.id))).rejects.toThrow();

    // simulate BullMQ's "failed" event after retries are exhausted
    await processor.onFailed({
      data: { videoId: video.id },
      opts: { attempts: 1 },
      attemptsMade: 1,
      failedReason: 'ffprobe failed',
    } as unknown as Job<ProcessVideoJobData>);

    const errored = await videos.findOneByOrFail({ id: video.id });
    expect(errored.status).toBe(VideoStatus.ERROR);
    expect(errored.failure_reason).toBeTruthy();
  }, 60000);
});
