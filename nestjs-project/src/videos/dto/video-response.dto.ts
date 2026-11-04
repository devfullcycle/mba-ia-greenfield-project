import { Video } from '../entities/video.entity';

export class VideoResponseDto {
  id: string;
  title: string | null;
  status: string;
  duration_seconds: number | null;
  original_filename: string;
  thumbnail_key: string | null;
  channel_id: string;
  created_at: Date;
  updated_at: Date;

  static fromEntity(video: Video): VideoResponseDto {
    const dto = new VideoResponseDto();
    dto.id = video.id;
    dto.title = video.title;
    dto.status = video.status;
    dto.duration_seconds = video.duration_seconds;
    dto.original_filename = video.original_filename;
    dto.thumbnail_key = video.thumbnail_key;
    dto.channel_id = video.channel_id;
    dto.created_at = video.created_at;
    dto.updated_at = video.updated_at;
    return dto;
  }
}
