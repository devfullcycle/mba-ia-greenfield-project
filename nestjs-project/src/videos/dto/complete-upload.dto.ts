import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UploadPartDto {
  /** The ETag header value returned by MinIO after uploading this part. */
  @IsString()
  @IsNotEmpty()
  ETag: string;

  /** The part number of this uploaded chunk. */
  @IsInt()
  @Min(1)
  PartNumber: number;
}

export class CompleteUploadDto {
  /** The S3 Upload ID returned during initiation. */
  @IsString()
  @IsNotEmpty()
  uploadId: string;

  /** List of all uploaded parts with their ETags and part numbers. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UploadPartDto)
  parts: UploadPartDto[];
}
