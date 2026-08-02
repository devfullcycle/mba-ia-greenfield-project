import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const TEN_GB_IN_BYTES = 10 * 1024 * 1024 * 1024;

export class CreateVideoDto {
  @IsString()
  @MaxLength(255)
  originalFilename: string;

  @IsString()
  @Matches(/^video\//)
  mimeType: string;

  @IsInt()
  @Min(1)
  @Max(TEN_GB_IN_BYTES)
  sizeBytes: number;
}
