import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Max,
  Min,
} from 'class-validator';

export class PresignedPartsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10_000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10_000, { each: true })
  part_numbers!: number[];
}
