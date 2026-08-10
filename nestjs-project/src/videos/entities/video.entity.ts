import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export type VideoStatus = 'draft' | 'processing' | 'ready' | 'failed';

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 11 })
  slug: string;

  @Index()
  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({
    type: 'enum',
    enum: ['draft', 'processing', 'ready', 'failed'],
    default: 'draft',
  })
  status: VideoStatus;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'varchar' })
  original_filename: string;

  @Column({ type: 'varchar' })
  mime_type: string;

  @Column({ type: 'bigint' })
  size_bytes: string;

  @Column({ type: 'varchar' })
  original_key: string;

  @Column({ type: 'varchar', nullable: true })
  upload_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'int', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  failure_reason: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
