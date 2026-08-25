import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from '../videos/entities/video.entity';

interface FfprobeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  bit_rate?: string;
}

interface FfprobeOutput {
  streams: FfprobeStream[];
  format: { duration?: string; bit_rate?: string };
}

interface VideoMetadata {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  codec: string | null;
  bitrate: number | null;
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(`${command} exited with code ${code}: ${stderr.trim()}`),
        );
        return;
      }
      resolve(stdout);
    });
  });
}

function parseFfprobeOutput(raw: string): VideoMetadata {
  const parsed = JSON.parse(raw) as FfprobeOutput;
  const videoStream = parsed.streams.find((s) => s.codec_type === 'video');
  const durationRaw = parsed.format.duration;
  if (!durationRaw) {
    throw new Error('ffprobe output is missing format.duration');
  }
  const bitrateRaw = parsed.format.bit_rate ?? videoStream?.bit_rate;

  return {
    durationSeconds: Math.round(parseFloat(durationRaw)),
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    codec: videoStream?.codec_name ?? null,
    bitrate: bitrateRaw ? parseInt(bitrateRaw, 10) : null,
  };
}

@Injectable()
export class VideoProcessingService {
  private readonly logger = new Logger(VideoProcessingService.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
  ) {}

  async process(videoId: string, originalKey: string): Promise<void> {
    const video = await this.videoRepository.findOneByOrFail({ id: videoId });
    const workDir = await mkdtemp(join(tmpdir(), 'video-processing-'));
    const originalPath = join(workDir, 'original');
    const thumbnailPath = join(workDir, 'thumbnail.jpg');

    try {
      await this.storageService.downloadToFile(originalKey, originalPath);

      const probeOutput = await runCommand('ffprobe', [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        originalPath,
      ]);
      const metadata = parseFfprobeOutput(probeOutput);

      const seekSeconds =
        metadata.durationSeconds > 2 ? 1 : metadata.durationSeconds / 2;
      await runCommand('ffmpeg', [
        '-y',
        '-ss',
        String(seekSeconds),
        '-i',
        originalPath,
        '-frames:v',
        '1',
        thumbnailPath,
      ]);

      const thumbnailKey = `videos/${video.channel_id}/${video.id}/thumbnail.jpg`;
      await this.storageService.uploadFile(
        thumbnailKey,
        thumbnailPath,
        'image/jpeg',
      );

      video.status = VideoStatus.PRONTO;
      video.duration_seconds = metadata.durationSeconds;
      video.width = metadata.width;
      video.height = metadata.height;
      video.codec = metadata.codec;
      video.bitrate = metadata.bitrate;
      video.thumbnail_key = thumbnailKey;
      video.processing_error = null;
      await this.videoRepository.save(video);
    } catch (err) {
      this.logger.error(
        `Failed to process video ${videoId}: ${(err as Error).message}`,
      );
      video.status = VideoStatus.ERRO;
      video.processing_error = (err as Error).message;
      await this.videoRepository.save(video);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
