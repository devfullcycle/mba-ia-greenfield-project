import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus, VideoVisibility } from '../videos.constants';

export class VideoResponseDto {
  @ApiProperty({ example: 'V1StGXR8_Z5' })
  public_id: string;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;

  @ApiProperty({ enum: VideoVisibility })
  visibility: VideoVisibility;

  @ApiProperty({ type: Number, nullable: true })
  duration_seconds: number | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  metadata: Record<string, unknown> | null;

  @ApiProperty()
  has_thumbnail: boolean;
}

export class PlaybackUrlResponseDto {
  @ApiProperty({ description: 'Presigned GET URL in the storage' })
  url: string;

  @ApiProperty({ description: 'Seconds until the URL expires' })
  expires_in: number;
}
