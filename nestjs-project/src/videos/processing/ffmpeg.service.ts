import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface VideoMetadata {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  codec: string | null;
  bitrate: number | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; bit_rate?: string };
}

@Injectable()
export class FfmpegService {
  async extractMetadata(inputPath: string): Promise<VideoMetadata> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ]);

    const parsed = JSON.parse(stdout) as FfprobeOutput;
    const videoStream = (parsed.streams ?? []).find(
      (s) => s.codec_type === 'video',
    );

    const rawDuration = parseFloat(
      parsed.format?.duration ?? videoStream?.duration ?? '0',
    );

    return {
      durationSeconds: Number.isFinite(rawDuration)
        ? Math.round(rawDuration)
        : 0,
      width: videoStream?.width ?? null,
      height: videoStream?.height ?? null,
      codec: videoStream?.codec_name ?? null,
      bitrate: parsed.format?.bit_rate
        ? parseInt(parsed.format.bit_rate, 10)
        : null,
    };
  }

  async generateThumbnail(
    inputPath: string,
    outputPath: string,
    atSeconds = 1,
  ): Promise<void> {
    await execFileAsync('ffmpeg', [
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
}
