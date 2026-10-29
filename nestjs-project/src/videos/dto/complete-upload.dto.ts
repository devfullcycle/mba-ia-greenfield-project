import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_UPLOAD_PARTS } from '../videos.constants';

export class CompletedPartDto {
  /** Part number, starting at 1. */
  @IsInt()
  @Min(1)
  partNumber: number;

  /** `ETag` header returned by the storage when the part was uploaded. */
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteUploadDto {
  /** Every uploaded part with its `ETag`. */
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_UPLOAD_PARTS)
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts: CompletedPartDto[];
}
