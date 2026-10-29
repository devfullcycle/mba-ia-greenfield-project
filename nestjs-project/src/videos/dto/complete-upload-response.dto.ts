import { ApiProperty } from '@nestjs/swagger';
import { ProcessingStatus } from '../video.enums';

export class CompleteUploadResponseDto {
  @ApiProperty({
    description: "The video's public identifier (`publicId`)",
    example: 'dQw4w9WgXcQ',
  })
  id: string;

  @ApiProperty({ enum: ProcessingStatus, example: ProcessingStatus.PROCESSING })
  processingStatus: ProcessingStatus;
}
