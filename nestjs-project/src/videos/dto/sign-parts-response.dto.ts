import { ApiProperty } from '@nestjs/swagger';

export class SignedPartDto {
  @ApiProperty({ example: 1 })
  partNumber: number;

  @ApiProperty({
    description: 'Presigned PUT URL for this part',
    example: 'http://localhost:8333/streamtube/videos/.../original.mp4?...',
  })
  url: string;
}

export class SignPartsResponseDto {
  @ApiProperty({ type: [SignedPartDto] })
  parts: SignedPartDto[];

  @ApiProperty({
    description: 'Seconds until the presigned URLs expire',
    example: 3600,
  })
  expiresInSeconds: number;
}
