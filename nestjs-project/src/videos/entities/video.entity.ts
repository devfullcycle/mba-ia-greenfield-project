import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export const VIDEO_STATUSES = [
  'DRAFT',
  'PROCESSING',
  'READY',
  'ERROR',
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

/** PostgreSQL returns bigint as string; values here stay below 2^53. */
const bigintToNumber: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('videos')
@Index(['status', 'updated_at'])
export class Video {
  /** Generated in the application so the storage key exists before INSERT. */
  @PrimaryColumn('uuid')
  id: string;

  /**
   * Always written by the application from `reserveSeq()` — never `@Generated`,
   * because TypeORM drops increment columns from the INSERT and `public_id`
   * must be derived from this exact value.
   */
  @Column({ type: 'bigint', unique: true, transformer: bigintToNumber })
  seq: number;

  @Column({ type: 'varchar', length: 32, unique: true })
  public_id: string;

  @Index()
  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'enum', enum: VIDEO_STATUSES, default: 'DRAFT' })
  status: VideoStatus;

  @Column({ type: 'varchar', length: 255 })
  original_filename: string;

  @Column({ type: 'varchar', length: 127 })
  mime_type: string;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  size_bytes: number;

  @Column({ type: 'varchar', length: 255 })
  storage_key: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  upload_id: string | null;

  @Column({ type: 'double precision', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'integer', nullable: true })
  width: number | null;

  @Column({ type: 'integer', nullable: true })
  height: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  codec: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  error_reason: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
