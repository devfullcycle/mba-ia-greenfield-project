import type { VideoStatus } from '../entities/video.entity';

export class CompleteUploadResponseDto {
  /** Video public id. */
  id: string;

  /** Always `PROCESSING` after a successful completion. */
  status: VideoStatus;
}
