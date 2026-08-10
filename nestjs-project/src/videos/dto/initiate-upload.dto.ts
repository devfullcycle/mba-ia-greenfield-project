import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Max,
} from 'class-validator';

export class InitiateUploadDto {
  /** The title of the video. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  /** Optional description for the video. */
  @IsString()
  @IsOptional()
  description?: string;

  /** Original filename of the video file. */
  @IsString()
  @IsNotEmpty()
  fileName: string;

  /** MIME type of the video file (e.g., video/mp4). */
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  /** Total size of the video file in bytes (max 10GB). */
  @IsInt()
  @IsPositive()
  @Max(10 * 1024 * 1024 * 1024)
  fileSizeBytes: number;
}
