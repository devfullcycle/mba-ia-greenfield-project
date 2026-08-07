import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';

export interface ProbeResult {
  durationSeconds: number;
  metadata: {
    codec?: string;
    width?: number;
    height?: number;
    bitRate?: number;
  };
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
}

interface FfprobeOutput {
  format?: { duration?: string; bit_rate?: string };
  streams?: FfprobeStream[];
}

/**
 * Thin wrapper over the system ffmpeg/ffprobe binaries (installed in the worker
 * image). Spawns the processes directly — no third-party wrapper in the critical
 * path — and parses their output.
 */
@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);

  /** Extracts duration (seconds) and basic stream metadata via ffprobe. */
  async probe(inputPath: string): Promise<ProbeResult> {
    const { stdout } = await this.run('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ]);

    const parsed = JSON.parse(stdout) as FfprobeOutput;
    const durationSeconds = Math.round(Number(parsed.format?.duration ?? 0));
    const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');

    return {
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
      metadata: {
        codec: videoStream?.codec_name,
        width: videoStream?.width,
        height: videoStream?.height,
        bitRate: parsed.format?.bit_rate
          ? Number(parsed.format.bit_rate)
          : undefined,
      },
    };
  }

  /** Captures a single frame at `atSeconds` as a JPEG thumbnail. */
  async extractThumbnail(
    inputPath: string,
    outputPath: string,
    atSeconds: number,
  ): Promise<void> {
    await this.run('ffmpeg', [
      '-y',
      '-ss',
      String(atSeconds),
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      outputPath,
    ]);
  }

  private run(
    command: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          this.logger.error(`${command} exited with code ${code}: ${stderr}`);
          reject(
            new Error(`${command} failed (code ${code}): ${stderr.trim()}`),
          );
        }
      });
    });
  }
}
