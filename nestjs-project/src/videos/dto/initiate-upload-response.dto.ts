import { ApiProperty } from '@nestjs/swagger';

export class InitiateUploadResponseDto {
  @ApiProperty({
    example: 'f3b890a1-8cb1-447b-8321-df1c2d9a3b89',
    format: 'uuid',
  })
  videoId: string;

  @ApiProperty({
    example: 'zK9sL2pQ5rT8',
    description: 'Short unique URL identifier',
  })
  unique_url_id: string;

  @ApiProperty({
    example: 'mp4-upload-id-from-s3',
    description: 'Multipart upload ID',
  })
  uploadId: string;

  @ApiProperty({
    example: 'videos/zK9sL2pQ5rT8/video.mp4',
    description: 'Storage object key',
  })
  key: string;
}
