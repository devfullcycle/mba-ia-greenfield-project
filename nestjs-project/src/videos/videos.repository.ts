import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, type Repository } from 'typeorm';
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

export type ProcessingResult = Pick<
  Video,
  'duration_seconds' | 'width' | 'height' | 'codec' | 'thumbnail_key'
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

  async findById(id: string): Promise<Video | null> {
    return this.repository.findOneBy({ id });
  }

  /** PROCESSING -> READY with the extracted metadata; no-op if no longer PROCESSING. */
  async markReady(id: string, result: ProcessingResult): Promise<void> {
    await this.repository.update(
      { id, status: 'PROCESSING' },
      { ...result, status: 'READY', error_reason: null },
    );
  }

  /** PROCESSING -> ERROR with a permanent failure reason; no-op if no longer PROCESSING. */
  async markError(id: string, reason: string): Promise<void> {
    await this.repository.update(
      { id, status: 'PROCESSING' },
      { status: 'ERROR', error_reason: reason },
    );
  }

  /** PROCESSING videos untouched since `updatedBefore` (served by the (status, updated_at) index). */
  async findStaleProcessing(updatedBefore: Date): Promise<Video[]> {
    return this.repository.find({
      where: { status: 'PROCESSING', updated_at: LessThan(updatedBefore) },
      order: { updated_at: 'ASC' },
    });
  }

  /**
   * Deletes the row only while it is still DRAFT, so a concurrent complete that
   * already moved it to PROCESSING wins. Returns false when nothing was deleted.
   */
  async deleteDraft(id: string): Promise<boolean> {
    const result = await this.repository.delete({ id, status: 'DRAFT' });
    return (result.affected ?? 0) > 0;
  }
}
