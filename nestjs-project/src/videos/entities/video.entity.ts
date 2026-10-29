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
import { ProcessingStatus, PublicationState } from '../video.enums';

@Entity('videos')
@Index(['processingStatus', 'updatedAt'])
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'public_id', type: 'varchar', length: 11, unique: true })
  publicId: string;

  @Index()
  @Column({ name: 'channel_id', type: 'uuid' })
  channelId: string;

  @Column({ name: 'original_filename', type: 'varchar', length: 255 })
  originalFilename: string;

  @Column({ name: 'content_type', type: 'varchar', length: 100 })
  contentType: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes: string;

  @Column({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey: string;

  @Column({ name: 'upload_id', type: 'varchar', length: 255, nullable: true })
  uploadId: string | null;

  @Column({
    name: 'processing_status',
    type: 'enum',
    enum: ProcessingStatus,
    default: ProcessingStatus.UPLOADING,
  })
  processingStatus: ProcessingStatus;

  @Column({
    name: 'publication_state',
    type: 'enum',
    enum: PublicationState,
    default: PublicationState.DRAFT,
  })
  publicationState: PublicationState;

  @Column({
    name: 'failure_reason',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  failureReason: string | null;

  @Column({
    name: 'duration_seconds',
    type: 'numeric',
    nullable: true,
  })
  durationSeconds: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
