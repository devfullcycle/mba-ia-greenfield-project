import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { FfmpegError, FfmpegService } from './ffmpeg.service';

const thumbDirs = () =>
  readdirSync(tmpdir()).filter((name) => name.startsWith('thumb-'));

describe('FfmpegService (integration)', () => {
  let module: TestingModule;
  let service: FfmpegService;
  let storage: StorageService;
  let workDir: string;
  let videoPath: string;
  let textPath: string;
  const keys: string[] = [];

  beforeAll(async () => {
    // Tests run inside the container: sign against the internal storage host.
    process.env.STORAGE_PUBLIC_ENDPOINT = process.env.STORAGE_ENDPOINT;
    workDir = mkdtempSync(join(tmpdir(), 'ffmpeg-spec-'));
    videoPath = join(workDir, 'clip.mp4');
    textPath = join(workDir, 'not-a-video.txt');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=160x120:rate=10',
      '-pix_fmt',
      'yuv420p',
      videoPath,
    ]);
    execFileSync('sh', ['-c', `echo "hello" > ${textPath}`]);

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
      providers: [FfmpegService],
    }).compile();
    service = module.get(FfmpegService);
    storage = module.get(StorageService);
  });

  afterAll(async () => {
    await Promise.all(keys.map((key) => storage.deleteObject(key)));
    rmSync(workDir, { recursive: true, force: true });
    await module.close();
  });

  it('should probe a valid video for its duration and metadata', async () => {
    const result = await service.probe(videoPath);

    expect(result.durationSeconds).toBeCloseTo(2, 0);
    const streams = result.metadata.streams as { codec_type: string }[];
    expect(streams.some((s) => s.codec_type === 'video')).toBe(true);
  });

  it('should probe straight from a presigned storage URL', async () => {
    const key = `ffmpeg-spec/${Date.now()}.mp4`;
    keys.push(key);
    await storage.putObject(key, readFileSync(videoPath), 'video/mp4');
    const url = await storage.presignGetUrl(key);

    const result = await service.probe(url);

    expect(result.durationSeconds).toBeCloseTo(2, 0);
  });

  it('should extract a non-empty JPEG thumbnail and leave no temp files', async () => {
    const before = thumbDirs();

    const jpeg = await service.extractThumbnail(videoPath, 1);

    expect(jpeg.length).toBeGreaterThan(0);
    expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(thumbDirs()).toEqual(before);
  });

  it('should reject a file that is not a video', async () => {
    await expect(service.probe(textPath)).rejects.toBeInstanceOf(FfmpegError);
  });

  it('should reject thumbnail extraction for a non-video and still clean up', async () => {
    const before = thumbDirs();

    await expect(service.extractThumbnail(textPath, 1)).rejects.toBeInstanceOf(
      FfmpegError,
    );

    expect(thumbDirs()).toEqual(before);
  });

  describe('timeout', () => {
    let hanging: Server;
    let port: number;
    const sockets: Socket[] = [];

    beforeAll(async () => {
      // Accepts connections and never answers: the child blocks reading.
      hanging = createServer((socket) => {
        sockets.push(socket);
        socket.on('error', () => undefined);
      });
      await new Promise<void>((resolve) =>
        hanging.listen(0, '127.0.0.1', resolve),
      );
      port = (hanging.address() as { port: number }).port;
    });

    afterAll(() => {
      sockets.forEach((socket) => socket.destroy());
      return new Promise<void>((resolve) => hanging.close(() => resolve()));
    });

    it('should kill ffprobe on timeout', async () => {
      const started = Date.now();

      await expect(
        service.probe(`http://127.0.0.1:${port}/video.mp4`, { timeoutMs: 500 }),
      ).rejects.toThrow('timed out');

      expect(Date.now() - started).toBeLessThan(5000);
    });

    it('should remove the temp dir when ffmpeg times out', async () => {
      const before = thumbDirs();

      await expect(
        service.extractThumbnail(`http://127.0.0.1:${port}/video.mp4`, 1, {
          timeoutMs: 500,
        }),
      ).rejects.toThrow('timed out');

      expect(thumbDirs()).toEqual(before);
    });
  });
});
