import { ArrayMaxSize, ArrayNotEmpty, IsInt, Min } from 'class-validator';
import { MAX_PARTS_PER_SIGN_REQUEST } from '../videos.constants';

export class SignPartsDto {
  /** Part numbers to sign, starting at 1. */
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_PARTS_PER_SIGN_REQUEST)
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers: number[];
}
