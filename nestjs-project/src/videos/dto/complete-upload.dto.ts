import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class UploadedPartDto {
  /** 1-based part number. */
  @IsInt()
  @Min(1)
  part_number: number;

  /** ETag returned by storage for this part's PUT. */
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteUploadDto {
  /** Every uploaded part with its ETag (unique part numbers). */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique((part: UploadedPartDto) => part.part_number)
  @ValidateNested({ each: true })
  @Type(() => UploadedPartDto)
  parts: UploadedPartDto[];
}
