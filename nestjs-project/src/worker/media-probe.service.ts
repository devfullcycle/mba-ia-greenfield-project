import { Inject, Injectable } from '@nestjs/common';
import {
  EXEC_FILE,
  MEDIA_TOOL_TIMEOUT_MS,
  THUMBNAIL_MAX_WIDTH,
  THUMBNAIL_POSITION,
} from './worker.constants';

export type ExecFile = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface MediaProbeResult {
  durationSeconds: number;
  metadata: {
    container: string | null;
    bitRate: number | null;
    video: {
      codec: string | null;
      width: number | null;
      height: number | null;
      frameRate: string | null;
    };
    audio: { codec: string | null } | null;
  };
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
}

interface FfprobeOutput {
  format?: { format_name?: string; duration?: string; bit_rate?: string };
  streams?: FfprobeStream[];
}

/** The input is readable but is not a playable video (no video stream, no duration). */
export class InvalidMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMediaError';
  }
}

/** ffprobe/ffmpeg could not run or could not read the input. */
export class MediaToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaToolError';
  }
}

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Frame position for the thumbnail: ~10% in, kept inside very short videos. */
export function thumbnailTimestamp(durationSeconds: number): number {
  return Math.max(
    0,
    Math.min(durationSeconds * THUMBNAIL_POSITION, durationSeconds - 0.1),
  );
}

@Injectable()
export class MediaProbeService {
  constructor(@Inject(EXEC_FILE) private readonly exec: ExecFile) {}

  async probe(input: string): Promise<MediaProbeResult> {
    const stdout = await this.run('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      input,
    ]);

    let parsed: FfprobeOutput;
    try {
      parsed = JSON.parse(stdout) as FfprobeOutput;
    } catch {
      throw new MediaToolError('ffprobe returned output that is not JSON');
    }

    const video = parsed.streams?.find((s) => s.codec_type === 'video');
    if (!video) {
      throw new InvalidMediaError('The file has no video stream');
    }
    const duration = toNumberOrNull(parsed.format?.duration);
    if (duration === null || duration <= 0) {
      throw new InvalidMediaError('The video has no readable duration');
    }
    const audio = parsed.streams?.find((s) => s.codec_type === 'audio');

    return {
      durationSeconds: duration,
      metadata: {
        container: parsed.format?.format_name ?? null,
        bitRate: toNumberOrNull(parsed.format?.bit_rate),
        video: {
          codec: video.codec_name ?? null,
          width: video.width ?? null,
          height: video.height ?? null,
          frameRate: video.avg_frame_rate ?? null,
        },
        audio: audio ? { codec: audio.codec_name ?? null } : null,
      },
    };
  }

  async extractThumbnail(
    input: string,
    atSeconds: number,
    outputPath: string,
  ): Promise<void> {
    await this.run('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-ss',
      atSeconds.toFixed(3),
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      `scale=min(${THUMBNAIL_MAX_WIDTH}\\,iw):-2`,
      '-q:v',
      '3',
      outputPath,
    ]);
  }

  private async run(file: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await this.exec(file, args, {
        timeout: MEDIA_TOOL_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      return stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The command line (and so the presigned URL with its signature) is part
      // of execFile's error message — never let it reach logs or failureReason.
      throw new MediaToolError(
        `${file} failed: ${message.replace(/https?:\/\/\S+/g, '<url>')}`,
      );
    }
  }
}
