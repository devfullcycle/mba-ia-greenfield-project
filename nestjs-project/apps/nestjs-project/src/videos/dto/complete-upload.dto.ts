import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class UploadPartDto {
  @IsInt()
  @Min(1)
  partNumber: number;

  @IsString()
  eTag: string;
}

export class CompleteUploadDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UploadPartDto)
  parts: UploadPartDto[];
}
