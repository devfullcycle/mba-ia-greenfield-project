import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateVideoDto {
  @ApiProperty({ example: 'Updated video title', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;
}
