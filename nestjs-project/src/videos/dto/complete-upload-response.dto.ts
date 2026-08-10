import { ApiProperty } from '@nestjs/swagger';

export class CompleteUploadResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    example: 'PROCESSING',
    description: 'Current status of the video processing',
  })
  status: string;
}
