import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateVideoDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsString()
  file_name: string;

  @IsInt()
  @Min(1)
  @Max(10_737_418_240)
  file_size: number;

  @IsOptional()
  @IsString()
  @Matches(/^video\//, { message: 'content_type must be a video/* MIME type' })
  content_type?: string = 'video/mp4';
}
