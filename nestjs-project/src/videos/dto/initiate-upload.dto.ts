import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Max,
  Min,
} from 'class-validator';

export class InitiateUploadDto {
  @ApiProperty({ example: 'My first video', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @ApiProperty({
    example: 104857600,
    description: 'File size in bytes (max 10 GB)',
  })
  @IsInt()
  @Min(1)
  @Max(10_737_418_240)
  file_size: number;

  @ApiProperty({ example: 'video/mp4' })
  @IsString()
  @Matches(/^video\//)
  mime_type: string;
}
