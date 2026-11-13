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
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsString()
  @Matches(/^video\/[a-z0-9.+-]+$/i)
  mime_type!: string;

  @IsInt()
  @Min(1)
  @Max(10_737_418_240)
  file_size!: number;
}
