import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpeg, { type FfprobeData } from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { path as ffprobePath } from '@ffprobe-installer/ffprobe';

ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);
ffmpeg.setFfprobePath(ffprobePath);

export function probeVideo(url: string): Promise<FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(url, (err, data) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      resolve(data);
    });
  });
}

export async function generateThumbnail(
  url: string,
  timestampSeconds: number,
): Promise<Buffer> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'video-thumbnail-'));
  const filename = 'thumbnail.jpg';

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(url)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .screenshots({
          timestamps: [Math.max(0, Math.floor(timestampSeconds))],
          filename,
          folder: tmpDir,
        });
    });

    return await readFile(join(tmpDir, filename));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export function parseFrameRate(rFrameRate: string | undefined): number | null {
  if (!rFrameRate) {
    return null;
  }
  const [numerator, denominator] = rFrameRate.split('/').map(Number);
  if (!denominator) {
    return null;
  }
  return Math.round((numerator / denominator) * 100) / 100;
}
