import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetPartUrlDto {
  /** The part number of the chunk (1 to 10000). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber: number;

  /** The S3 Upload ID returned during initiation. */
  @IsString()
  @IsNotEmpty()
  uploadId: string;
}
