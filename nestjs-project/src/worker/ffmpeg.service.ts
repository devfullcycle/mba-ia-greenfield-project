import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const FFMPEG_TIMEOUT_MS = 120_000;
const THUMBNAIL_MAX_INSTANT_SECONDS = 5;
const THUMBNAIL_DURATION_FRACTION = 0.1;
const STDERR_TAIL_CHARS = 2000;

export class FfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FfmpegError';
  }
}

export interface ProbeResult {
  durationSeconds: number;
  /** Raw ffprobe JSON (`format` and `streams`). */
  metadata: Record<string, unknown>;
}

export interface FfmpegOptions {
  timeoutMs?: number;
}

/** Frame instant for the thumbnail: 10% into the video, at most 5 s. */
export function thumbnailInstant(durationSeconds: number): number {
  return Math.min(
    durationSeconds * THUMBNAIL_DURATION_FRACTION,
    THUMBNAIL_MAX_INSTANT_SECONDS,
  );
}

/**
 * Runs `ffprobe`/`ffmpeg` as child processes. Inputs are read straight from a
 * presigned GET URL (or path), so a large source is never downloaded whole.
 */
@Injectable()
export class FfmpegService {
  async probe(
    source: string,
    options: FfmpegOptions = {},
  ): Promise<ProbeResult> {
    const { stdout } = await this.run(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        source,
      ],
      options.timeoutMs,
    );

    let metadata: Record<string, unknown>;
    try {
      metadata = JSON.parse(stdout.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new FfmpegError('ffprobe returned invalid JSON');
    }
    const duration = Number(
      (metadata.format as { duration?: string } | undefined)?.duration,
    );
    if (!Number.isFinite(duration)) {
      throw new FfmpegError('ffprobe found no video duration');
    }
    return { durationSeconds: duration, metadata };
  }

  /** Returns the JPEG bytes of the frame at `atSeconds`; temp files are always removed. */
  async extractThumbnail(
    source: string,
    atSeconds: number,
    options: FfmpegOptions = {},
  ): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'thumb-'));
    const output = join(dir, 'thumbnail.jpg');
    try {
      await this.run(
        'ffmpeg',
        [
          '-v',
          'error',
          '-ss',
          String(atSeconds),
          '-i',
          source,
          '-frames:v',
          '1',
          '-q:v',
          '2',
          '-y',
          output,
        ],
        options.timeoutMs,
      );
      const jpeg = await readFile(output).catch(() => Buffer.alloc(0));
      if (jpeg.length === 0) {
        throw new FfmpegError('ffmpeg produced no thumbnail');
      }
      return jpeg;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private run(
    command: string,
    args: string[],
    timeoutMs = FFMPEG_TIMEOUT_MS,
  ): Promise<{ stdout: Buffer }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      let stderr = '';
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(() =>
          reject(new FfmpegError(`${command} timed out after ${timeoutMs}ms`)),
        );
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL_CHARS);
      });
      child.on('error', (error) =>
        settle(() =>
          reject(
            new FfmpegError(`${command} failed to start: ${error.message}`),
          ),
        ),
      );
      child.on('close', (code) =>
        settle(() =>
          code === 0
            ? resolve({ stdout: Buffer.concat(stdout) })
            : reject(
                new FfmpegError(
                  `${command} exited with code ${code}: ${stderr.trim()}`,
                ),
              ),
        ),
      );
    });
  }
}
