import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class InitUploadDto {
  /** Original file name, kept for the download `Content-Disposition`. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  originalFilename: string;

  /** Declared media type, validated against the video allowlist. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  contentType: string;

  /** Declared file size in bytes (up to 10GB). */
  @IsInt()
  @Min(1)
  sizeBytes: number;
}
