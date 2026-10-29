import { ApiProperty } from '@nestjs/swagger';
import { ProcessingStatus } from '../video.enums';

export class InitUploadResponseDto {
  @ApiProperty({
    description: "The video's public identifier (`publicId`)",
    example: 'dQw4w9WgXcQ',
  })
  id: string;

  @ApiProperty({
    description: 'Fixed size in bytes of every part except the last',
    example: 67108864,
  })
  partSizeBytes: number;

  @ApiProperty({
    description: 'Number of parts the file must be split into',
    example: 16,
  })
  partCount: number;

  @ApiProperty({ enum: ProcessingStatus, example: ProcessingStatus.UPLOADING })
  processingStatus: ProcessingStatus;
}
