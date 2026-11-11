import type { VideoStatus } from '../entities/video.entity';
import { UploadPartUrlDto } from './upload-part-url.dto';

export class InitiateUploadResponseDto {
  /** Video public id. */
  id: string;

  /** Always `DRAFT` right after initiation. */
  status: VideoStatus;

  /** Bytes per part (the last part may be smaller). */
  part_size: number;

  /** Number of parts the file must be split into. */
  part_count: number;

  /** One presigned `PUT` URL per part. */
  parts: UploadPartUrlDto[];

  /** When the part URLs expire (ISO-8601). */
  expires_at: string;
}
