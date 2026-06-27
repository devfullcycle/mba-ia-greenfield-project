import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { FfmpegService } from './ffmpeg.service';

const execFileAsync = promisify(execFile);

// JPEG files start with the SOI marker 0xFFD8 and end with EOI 0xFFD9.
function isJpeg(buffer: Buffer): boolean {
  return (
    buffer.length > 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  );
}

async function generateSampleClip(
  path: string,
  seconds: number,
): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${seconds}:size=160x120:rate=15`,
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
}

describe('FfmpegService (integration, real ffmpeg)', () => {
  let service: FfmpegService;
  let workDir: string;
  let samplePath: string;

  beforeAll(async () => {
    service = new FfmpegService();
    workDir = await mkdtemp(join(tmpdir(), 'ffmpeg-it-'));
    samplePath = join(workDir, 'sample.mp4');
    await generateSampleClip(samplePath, 2);
  }, 30000);

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('extracts metadata from a real clip', async () => {
    const metadata = await service.extractMetadata(samplePath);

    expect(metadata.durationSeconds).toBe(2);
    expect(metadata.width).toBe(160);
    expect(metadata.height).toBe(120);
    expect(metadata.codec).toBeTruthy();
    expect(metadata.bitrate).toBeGreaterThan(0);
  }, 30000);

  it('generates a non-empty JPEG thumbnail', async () => {
    const thumbnailPath = join(workDir, 'thumb.jpg');

    await service.generateThumbnail(samplePath, thumbnailPath, 1);

    const stats = await stat(thumbnailPath);
    expect(stats.size).toBeGreaterThan(0);

    const buffer = await readFile(thumbnailPath);
    expect(isJpeg(buffer)).toBe(true);
  }, 30000);
});
