import { IsInt, IsPositive, IsString } from 'class-validator';

export class InitiateUploadDto {
  @IsString()
  filename: string;

  @IsString()
  mimeType: string;

  @IsInt()
  @IsPositive()
  sizeBytes: number;
}
