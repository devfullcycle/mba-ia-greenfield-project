import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsInt,
  Max,
  Min,
} from 'class-validator';
import { MAX_UPLOAD_PARTS } from '../videos.constants';

export class SignPartsDto {
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(MAX_UPLOAD_PARTS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(MAX_UPLOAD_PARTS, { each: true })
  part_numbers: number[];
}
