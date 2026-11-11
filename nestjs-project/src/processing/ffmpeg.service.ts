import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import {
  FfmpegProcessError,
  FfmpegTimeoutError,
  NoDurationError,
  NoVideoStreamError,
} from './processing.errors';

export const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;

export interface VideoMetadata {
  duration_seconds: number;
  width: number | null;
  height: number | null;
  codec: string | null;
}

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    duration?: string;
  }[];
}

/** Thin wrapper over the ffprobe/ffmpeg binaries; reads media straight from a URL. */
@Injectable()
export class FfmpegService {
  async probe(url: string): Promise<VideoMetadata> {
    const stdout = await this.run('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      url,
    ]);
    const output = JSON.parse(stdout.toString('utf8')) as FfprobeOutput;

    const video = output.streams?.find(
      (stream) => stream.codec_type === 'video',
    );
    if (!video) throw new NoVideoStreamError();

    const duration = Number(output.format?.duration ?? video.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new NoDurationError();
    }

    return {
      duration_seconds: duration,
      width: video.width ?? null,
      height: video.height ?? null,
      codec: video.codec_name ?? null,
    };
  }

  /** Returns a single JPEG frame taken at `atSeconds`. */
  async extractFrame(url: string, atSeconds: number): Promise<Buffer> {
    return this.run('ffmpeg', [
      '-v',
      'error',
      '-ss',
      atSeconds.toFixed(3),
      '-i',
      url,
      '-frames:v',
      '1',
      '-f',
      'image2',
      '-c:v',
      'mjpeg',
      'pipe:1',
    ]);
  }

  private run(command: 'ffprobe' | 'ffmpeg', args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, FFMPEG_TIMEOUT_MS);

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new FfmpegTimeoutError(command, FFMPEG_TIMEOUT_MS));
        } else if (code !== 0) {
          reject(
            new FfmpegProcessError(
              command,
              code,
              Buffer.concat(stderr).toString('utf8'),
            ),
          );
        } else {
          resolve(Buffer.concat(stdout));
        }
      });
    });
  }
}
