import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsInt, Max, Min } from 'class-validator';

export class UploadPartUrlsDto {
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10000, { each: true })
  partNumbers: number[];
}
