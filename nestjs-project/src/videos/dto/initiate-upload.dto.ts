import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class InitiateUploadDto {
  @IsString()
  @IsNotEmpty()
  original_filename: string;

  @IsString()
  @IsNotEmpty()
  content_type: string;

  @IsInt()
  @Min(1)
  size_bytes: number;
}
