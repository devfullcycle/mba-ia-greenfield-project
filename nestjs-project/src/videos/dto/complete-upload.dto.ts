import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CompleteUploadPartDto {
  @IsInt()
  partNumber: number;

  @IsString()
  etag: string;
}

export class CompleteUploadDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CompleteUploadPartDto)
  parts: CompleteUploadPartDto[];
}
