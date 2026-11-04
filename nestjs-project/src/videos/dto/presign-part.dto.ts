import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class PresignPartDto {
  @ApiProperty({
    description: '1-based multipart part number (1..10000)',
    minimum: 1,
    maximum: 10000,
    example: 1,
  })
  @IsInt()
  @Min(1)
  @Max(10000)
  part_number: number;
}
