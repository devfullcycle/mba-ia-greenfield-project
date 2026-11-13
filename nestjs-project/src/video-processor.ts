import { Client } from 'minio';
import { DataSource, Repository } from 'typeorm';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Channel } from './channels/entities/channel.entity';
import { User } from './users/entities/user.entity';
import { Video } from './videos/entities/video.entity';
import { VideoStatus } from './videos/enums/video-status.enum';

const execFileAsync = promisify(execFile);

export interface VideoJobData {
  videoId: string;
  storageKey: string;
  mimeType?: string | null;
}

export interface ProbeMetadata {
  durationSeconds: number;
  format: Record<string, unknown>;
  videoStream: Record<string, unknown> | null;
  audioStream: Record<string, unknown> | null;
}

export function parseProbeMetadata(raw: string): ProbeMetadata {
  const probe = JSON.parse(raw) as {
    format?: Record<string, unknown>;
    streams?: Array<Record<string, unknown>>;
  };
  const streams = probe.streams ?? [];
  const videoStream =
    streams.find((stream) => stream.codec_type === 'video') ?? null;
  const audioStream =
    streams.find((stream) => stream.codec_type === 'audio') ?? null;
  const duration = Number(probe.format?.duration ?? videoStream?.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0 || !videoStream) {
    throw new Error('ffprobe did not return a valid video stream');
  }
  return {
    durationSeconds: duration,
    format: probe.format ?? {},
    videoStream,
    audioStream,
  };
}

export class VideoProcessor {
  private readonly videoRepository: Repository<Video>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly storageClient: Client,
    private readonly bucket: string,
  ) {
    this.videoRepository = dataSource.getRepository(Video);
  }

  async process(
    job: VideoJobData,
  ): Promise<{ videoId: string; status: VideoStatus }> {
    const workspace = await mkdtemp(join(tmpdir(), 'streamtube-video-'));
    const sourcePath = join(workspace, 'source');
    const thumbnailPath = join(workspace, 'thumbnail.jpg');
    const thumbnailKey = `videos/${job.videoId}/thumbnail.jpg`;

    try {
      const source = await this.storageClient.getObject(
        this.bucket,
        job.storageKey,
      );
      await pipeline(source, createWriteStream(sourcePath));

      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        sourcePath,
      ]);
      const metadata = parseProbeMetadata(stdout);

      await execFileAsync('ffmpeg', [
        '-y',
        '-ss',
        '00:00:01',
        '-i',
        sourcePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-1',
        thumbnailPath,
      ]);
      const thumbnail = await readFile(thumbnailPath);
      await this.storageClient.putObject(
        this.bucket,
        thumbnailKey,
        thumbnail,
        thumbnail.length,
        { 'Content-Type': 'image/jpeg' },
      );

      const video = await this.videoRepository.findOneBy({ id: job.videoId });
      if (!video) throw new Error(`Video ${job.videoId} not found`);
      video.duration_seconds = metadata.durationSeconds;
      video.metadata = {
        format: metadata.format,
        video_stream: metadata.videoStream,
        audio_stream: metadata.audioStream,
      };
      video.thumbnail_key = thumbnailKey;
      video.processing_error = null;
      video.status = VideoStatus.READY;
      await this.videoRepository.save(video);
      return { videoId: video.id, status: video.status };
    } catch (error) {
      const video = await this.videoRepository.findOneBy({ id: job.videoId });
      if (video) {
        video.status = VideoStatus.ERROR;
        video.processing_error =
          error instanceof Error ? error.message : String(error);
        await this.videoRepository.save(video);
      }
      throw error;
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

export function createWorkerDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USERNAME || 'streamtube',
    password: process.env.DB_PASSWORD || 'streamtube',
    database: process.env.DB_NAME || 'streamtube',
    synchronize: false,
    entities: [Video, Channel, User],
  });
}

export function createWorkerStorageClient(): Client {
  return new Client({
    endPoint: process.env.STORAGE_ENDPOINT || 'minio',
    port: Number(process.env.STORAGE_PORT || 9000),
    useSSL: process.env.STORAGE_USE_SSL === 'true',
    accessKey: process.env.STORAGE_ACCESS_KEY || 'streamtube',
    secretKey: process.env.STORAGE_SECRET_KEY || 'streamtube-local-secret',
  });
}

export function workerBucket(): string {
  return process.env.STORAGE_BUCKET || 'streamtube-videos';
}
