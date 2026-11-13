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
import { VideoStatus } from '../enums/video-status.enum';

@Entity('videos')
@Index(['channel_id', 'status'])
@Index(['status'])
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  channel_id!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title!: string | null;

  @Column({ type: 'enum', enum: VideoStatus, default: VideoStatus.DRAFT })
  status!: VideoStatus;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 500, nullable: true })
  storage_key!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  thumbnail_key!: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  upload_id!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mime_type!: string | null;

  @Column({ type: 'bigint', nullable: true })
  file_size!: string | null;

  @Column({ type: 'numeric', nullable: true })
  duration_seconds!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  processing_error!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel!: Channel;
}
