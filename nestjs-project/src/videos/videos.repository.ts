import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Video } from './entities/video.entity';
import { VIDEO_SEQUENCE } from './videos.constants';

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
}
