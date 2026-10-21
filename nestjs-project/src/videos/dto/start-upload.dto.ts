import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class StartUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  size_bytes: number;

  @IsString()
  @IsNotEmpty()
  content_type: string;
}
