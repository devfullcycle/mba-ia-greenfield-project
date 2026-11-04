import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CompletedUploadPartDto {
  @ApiProperty({
    description: '1-based part number uploaded to S3',
    minimum: 1,
    maximum: 10000,
    example: 1,
  })
  @IsInt()
  @Min(1)
  @Max(10000)
  part_number: number;

  @ApiProperty({
    description: 'ETag header returned by S3/MinIO when uploading the part',
    example: '"d41d8cd98f00b204e9800998ecf8427e"',
  })
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteUploadDto {
  @ApiPropertyOptional({
    description: 'Ordered or unordered list of uploaded S3 multipart parts',
    type: () => [CompletedUploadPartDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompletedUploadPartDto)
  parts?: CompletedUploadPartDto[];
}
