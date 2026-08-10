import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class VideoDetailsResponseDto {
  @ApiProperty({
    example: 'f3b890a1-8cb1-447b-8321-df1c2d9a3b89',
    format: 'uuid',
  })
  id: string;

  @ApiProperty({ example: 'My First Video Title' })
  title: string;

  @ApiProperty({
    example: 'This is the description of the video',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({ example: 'zK9sL2pQ5rT8' })
  unique_url_id: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.READY })
  status: VideoStatus;

  @ApiProperty({
    example: 'Something went wrong during transcoding',
    nullable: true,
  })
  failure_reason: string | null;

  @ApiProperty({
    example: 124.5,
    nullable: true,
    description: 'Duration of the video in seconds',
  })
  duration: number | null;

  @ApiProperty({
    example: 104857600,
    nullable: true,
    description: 'Size of the video file in bytes',
  })
  size_bytes: number | null;

  @ApiProperty({
    example: 'e2b102a1-1cb1-447b-8321-df1c2d9a3b89',
    format: 'uuid',
  })
  channel_id: string;

  @ApiProperty({ example: '2026-07-11T12:00:00.000Z' })
  created_at: Date;

  @ApiProperty({ example: '2026-07-11T12:05:00.000Z' })
  updated_at: Date;

  @ApiProperty({
    example: { format: { duration: 120 } },
    nullable: true,
    description:
      'JSON metadata extracted from the video file format and streams',
  })
  metadata: Record<string, any> | null;
}
