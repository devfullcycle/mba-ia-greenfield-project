import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_VIDEO_SIZE_BYTES,
  VIDEO_MIME_TYPE_PATTERN,
} from '../videos.constants';

export class InitiateUploadDto {
  /** Name of the file being uploaded; becomes the initial video title. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  original_filename: string;

  /** Must be a video MIME type, e.g. `video/mp4`. */
  @IsString()
  @Matches(VIDEO_MIME_TYPE_PATTERN, {
    message: 'mime_type must be a video MIME type',
  })
  mime_type: string;

  /** File size in bytes (max 10GB). */
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_SIZE_BYTES)
  size_bytes: number;
}
