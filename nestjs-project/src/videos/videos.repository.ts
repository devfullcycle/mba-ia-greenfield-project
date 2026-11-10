import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Video, type VideoStatus } from './entities/video.entity';
import { VIDEO_SEQUENCE } from './videos.constants';

export type NewVideo = Pick<
  Video,
  | 'id'
  | 'seq'
  | 'public_id'
  | 'channel_id'
  | 'title'
  | 'status'
  | 'original_filename'
  | 'mime_type'
  | 'size_bytes'
  | 'storage_key'
  | 'upload_id'
>;

/** Data access for `videos`; the only place that touches `Repository<Video>`. */
@Injectable()
export class VideosRepository {
  constructor(
    @InjectRepository(Video) private readonly repository: Repository<Video>,
  ) {}

  /**
   * Reserves the next `seq` so `seq` and `public_id` are written in the same INSERT.
   * The sequence only exists via migrations (see CreateVideos).
   */
  async reserveSeq(): Promise<number> {
    const [row] = await this.repository.query<{ seq: string }[]>(
      `SELECT nextval('${VIDEO_SEQUENCE}') AS seq`,
    );
    return Number(row.seq);
  }

  async insert(video: NewVideo): Promise<void> {
    await this.repository.insert(video);
  }

  /** Loads the video with its channel so callers can check ownership. */
  async findByPublicIdWithChannel(publicId: string): Promise<Video | null> {
    return this.repository.findOne({
      where: { public_id: publicId },
      relations: { channel: true },
    });
  }

  /**
   * Atomic status transition: only applies while the row is still in `from`.
   * Returns false when another request already moved it.
   */
  async transitionStatus(
    id: string,
    from: VideoStatus,
    to: VideoStatus,
  ): Promise<boolean> {
    const result = await this.repository.update(
      { id, status: from },
      { status: to },
    );
    return (result.affected ?? 0) > 0;
  }

  async deleteById(id: string): Promise<void> {
    await this.repository.delete({ id });
  }
}
