import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class UploadPartDto {
  @ApiProperty({ description: 'Part number (1-based)', minimum: 1 })
  @IsInt()
  @Min(1)
  partNumber: number;

  @ApiProperty({
    description: 'ETag returned by storage for the uploaded part',
  })
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteUploadDto {
  @ApiProperty({ type: [UploadPartDto], description: 'Uploaded parts' })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => UploadPartDto)
  parts: UploadPartDto[];
}
