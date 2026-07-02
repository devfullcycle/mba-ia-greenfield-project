import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class InitiateUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  originalFileName: string;

  // Allowlist membership is a domain rule (per phase-03-videos/TD-08), not a
  // shape rule — enforced in VideosService so violations map to the
  // UNSUPPORTED_MEDIA_TYPE domain exception, not the generic VALIDATION_ERROR.
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  // Same reasoning as mimeType — the 10GB cap is enforced in VideosService
  // so violations map to FILE_TOO_LARGE, not VALIDATION_ERROR.
  @IsInt()
  @IsPositive()
  sizeInBytes: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}
