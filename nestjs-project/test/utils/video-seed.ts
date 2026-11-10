import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { Channel } from '../../src/channels/entities/channel.entity';
import { User } from '../../src/users/entities/user.entity';
import {
  Video,
  type VideoStatus,
} from '../../src/videos/entities/video.entity';
import { VideoPublicIdService } from '../../src/videos/video-public-id.service';
import {
  videoSourceKey,
  videoThumbnailKey,
} from '../../src/videos/videos.constants';
import { VideosRepository } from '../../src/videos/videos.repository';

export async function channelOf(
  app: INestApplication,
  email: string,
): Promise<Channel> {
  const dataSource = app.get(DataSource);
  const user = await dataSource.getRepository(User).findOneByOrFail({ email });
  return dataSource
    .getRepository(Channel)
    .findOneByOrFail({ user_id: user.id });
}

/** Inserts a video row directly (seq reserved + public_id encoded like the real flow). */
export async function seedVideo(
  app: INestApplication,
  channelId: string,
  status: VideoStatus,
  overrides: Partial<Video> = {},
): Promise<Video> {
  const id = randomUUID();
  const seq = await app.get(VideosRepository).reserveSeq();
  const ready = status === 'READY';
  const video: Partial<Video> = {
    id,
    seq,
    public_id: app.get(VideoPublicIdService).encode(seq),
    channel_id: channelId,
    title: `${status.toLowerCase()}.mp4`,
    status,
    original_filename: `${status.toLowerCase()}.mp4`,
    mime_type: 'video/mp4',
    size_bytes: 1024,
    storage_key: videoSourceKey(id),
    upload_id: status === 'DRAFT' ? 'upload-id' : null,
    duration_seconds: ready ? 6 : null,
    width: ready ? 640 : null,
    height: ready ? 360 : null,
    codec: ready ? 'h264' : null,
    thumbnail_key: ready ? videoThumbnailKey(id) : null,
    error_reason: status === 'ERROR' ? 'INVALID_FILE' : null,
    ...overrides,
  };
  const repository = app.get(DataSource).getRepository(Video);
  await repository.insert(video);
  return repository.findOneByOrFail({ id });
}
