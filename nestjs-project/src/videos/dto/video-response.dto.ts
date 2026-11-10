import type { Video, VideoStatus } from '../entities/video.entity';

export class VideoResponseDto {
  /** Video public id (the internal UUID is never exposed). */
  id: string;

  title: string;

  status: VideoStatus;

  original_filename: string;

  mime_type: string;

  size_bytes: number;

  duration_seconds: number | null;

  width: number | null;

  height: number | null;

  codec: string | null;

  /** Only populated when status is ERROR. */
  error_reason: string | null;

  /** `/videos/{id}/stream` when READY, else null. */
  stream_url: string | null;

  /** `/videos/{id}/download` when READY, else null. */
  download_url: string | null;

  /** `/videos/{id}/thumbnail` when READY, else null. */
  thumbnail_url: string | null;

  created_at: string;

  /** Explicit allow-list: internal fields (UUID, storage keys, upload id, seq) never leak. */
  static from(video: Video): VideoResponseDto {
    const ready = video.status === 'READY';
    const base = `/videos/${video.public_id}`;
    return {
      id: video.public_id,
      title: video.title,
      status: video.status,
      original_filename: video.original_filename,
      mime_type: video.mime_type,
      size_bytes: video.size_bytes,
      duration_seconds: video.duration_seconds,
      width: video.width,
      height: video.height,
      codec: video.codec,
      error_reason: video.status === 'ERROR' ? video.error_reason : null,
      stream_url: ready ? `${base}/stream` : null,
      download_url: ready ? `${base}/download` : null,
      thumbnail_url: ready ? `${base}/thumbnail` : null,
      created_at: video.created_at.toISOString(),
    };
  }
}
