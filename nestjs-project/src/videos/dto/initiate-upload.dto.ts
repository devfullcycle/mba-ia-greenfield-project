import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
] as const;

export class InitiateUploadDto {
  @ApiProperty({
    description: 'Video title',
    maxLength: 200,
    example: 'Introdução ao NestJS com BullMQ e FFmpeg',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({
    description: 'Optional video description',
    maxLength: 5000,
    example: 'Aula prática sobre upload multipart e streaming.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({
    description: 'Original file name on client',
    maxLength: 255,
    example: 'aula-03.mp4',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  original_filename: string;

  @ApiProperty({
    description: 'Video MIME type',
    enum: ALLOWED_VIDEO_MIME_TYPES,
    example: 'video/mp4',
  })
  @IsString()
  @IsNotEmpty()
  mime_type: string;

  @ApiProperty({
    description: 'Total file size in bytes (up to 10GB = 10737418240)',
    minimum: 1,
    maximum: 10737418240,
    example: 52428800,
  })
  @IsInt()
  @Min(1)
  size_bytes: number;
}
