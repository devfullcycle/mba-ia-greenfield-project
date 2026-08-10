import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CompletedPartDto {
  @IsInt()
  @Min(1)
  partNumber: number;

  @IsString()
  eTag: string;
}

export class CompleteUploadDto {
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts: CompletedPartDto[];
}
