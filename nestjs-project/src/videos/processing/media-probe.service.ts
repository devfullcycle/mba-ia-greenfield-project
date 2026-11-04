import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ExtractedVideoMetadata {
  durationSeconds: number;
  width: number;
  height: number;
  codec: string;
}

interface FfprobeJsonOutput {
  streams?: Array<{
    width?: number;
    height?: number;
    codec_name?: string;
    duration?: string;
  }>;
  format?: {
    duration?: string;
  };
}

@Injectable()
export class MediaProbeService {
  async extractMetadata(filePath: string): Promise<ExtractedVideoMetadata> {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height,codec_name,duration:format=duration',
        '-of',
        'json',
        filePath,
      ],
      { timeout: 120_000 },
    );

    const parsed = JSON.parse(stdout) as FfprobeJsonOutput;
    const videoStream = parsed.streams?.[0];
    if (!videoStream || !videoStream.codec_name) {
      throw new Error('No valid video stream found in media file');
    }

    const rawDuration = parsed.format?.duration ?? videoStream.duration ?? '0';
    const parsedDuration = parseFloat(rawDuration);
    const durationSeconds =
      Number.isFinite(parsedDuration) && parsedDuration > 0
        ? Math.max(1, Math.round(parsedDuration))
        : 0;

    return {
      durationSeconds,
      width: Number(videoStream.width ?? 0),
      height: Number(videoStream.height ?? 0),
      codec: videoStream.codec_name,
    };
  }

  async generateThumbnail(
    videoFilePath: string,
    outputThumbPath: string,
    durationSeconds: number,
  ): Promise<void> {
    const seekSeconds =
      durationSeconds > 0
        ? Math.min(1, Number((durationSeconds / 2).toFixed(2)))
        : 0;

    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-ss',
        String(seekSeconds),
        '-i',
        videoFilePath,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        outputThumbPath,
      ],
      { timeout: 120_000 },
    );
  }
}
