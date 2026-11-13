import { IsInt, IsString, Max, Min } from 'class-validator';

export class StartUploadDto {
  @IsString()
  mime_type!: string;

  @IsInt()
  @Min(5 * 1024 * 1024)
  @Max(512 * 1024 * 1024)
  part_size!: number;

  @IsInt()
  @Min(1)
  @Max(10_000)
  total_parts!: number;
}
