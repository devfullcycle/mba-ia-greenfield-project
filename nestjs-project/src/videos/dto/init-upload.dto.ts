import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DEFAULT_UPLOAD_MAX_SIZE } from '../videos.constants';

export class InitUploadDto {
  @ApiProperty({ description: 'Video title', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: 'Original file name' })
  @IsString()
  @IsNotEmpty()
  filename: string;

  @ApiProperty({ description: 'MIME content type of the file' })
  @IsString()
  @IsNotEmpty()
  contentType: string;

  @ApiProperty({
    description: 'File size in bytes',
    minimum: 1,
    maximum: DEFAULT_UPLOAD_MAX_SIZE,
  })
  @IsInt()
  @Min(1)
  @Max(DEFAULT_UPLOAD_MAX_SIZE)
  size: number;
}
