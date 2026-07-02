import { IsInt } from 'class-validator';

export class UploadPartUrlDto {
  // Range validation (>= 1) is a domain rule (per phase-03-videos/TD Error
  // Catalog) enforced in VideosService so violations map to the
  // UPLOAD_PART_INVALID domain exception, not the generic VALIDATION_ERROR.
  @IsInt()
  partNumber: number;
}
