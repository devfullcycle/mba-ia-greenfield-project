import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as argon2 from 'argon2';
import Sqids from 'sqids';
import type { DataSource } from 'typeorm';
import {
  VIDEO_PUBLIC_ID_MIN_LENGTH,
  videoSourceKey,
  videoThumbnailKey,
} from '../../videos/videos.constants';

/**
 * Idempotent dev data for the manual Phase 03 walkthrough
 * (docs/phases/phase-03-videos/manual-api-test.md).
 * Ids are fixed so the hardcoded .http files in http/phase-03-manual keep working.
 */
export const DEV_PASSWORD = 'senha12345';

export const DEV_USERS = {
  owner: {
    id: '00000000-0000-4000-8000-0000000000a1',
    email: 'dev@streamtube.local',
    channelId: '00000000-0000-4000-8000-0000000000c1',
    nickname: 'dev-channel',
  },
  other: {
    id: '00000000-0000-4000-8000-0000000000b1',
    email: 'other@streamtube.local',
    channelId: '00000000-0000-4000-8000-0000000000c2',
    nickname: 'other-channel',
  },
} as const;

type SeedStatus = 'READY' | 'PROCESSING' | 'ERROR';

interface SeedVideo {
  id: string;
  seq: number;
  channelId: string;
  title: string;
  status: SeedStatus;
  withFiles: boolean;
  errorReason?: string;
}

export const DEV_VIDEOS: SeedVideo[] = [
  {
    id: '11111111-1111-4111-8111-111111111101',
    seq: 900001,
    channelId: DEV_USERS.owner.channelId,
    title: 'Seed: vídeo READY (dono)',
    status: 'READY',
    withFiles: true,
  },
  {
    id: '11111111-1111-4111-8111-111111111102',
    seq: 900002,
    channelId: DEV_USERS.owner.channelId,
    title: 'Seed: vídeo PROCESSING (dono)',
    status: 'PROCESSING',
    withFiles: false,
  },
  {
    id: '11111111-1111-4111-8111-111111111103',
    seq: 900003,
    channelId: DEV_USERS.owner.channelId,
    title: 'Seed: vídeo ERROR (dono)',
    status: 'ERROR',
    withFiles: false,
    errorReason: 'PROBE_FAILED',
  },
  {
    id: '11111111-1111-4111-8111-111111111104',
    seq: 900004,
    channelId: DEV_USERS.other.channelId,
    title: 'Seed: vídeo PROCESSING (outro usuário)',
    status: 'PROCESSING',
    withFiles: false,
  },
];

const FIXTURES_DIR = join(process.cwd(), 'test', 'video', 'fixtures');
const SAMPLE_VIDEO = { file: 'sample.mp4', size: 905702 };

export function seedPublicId(seq: number): string {
  const alphabet = process.env.VIDEO_PUBLIC_ID_ALPHABET;
  if (!alphabet) throw new Error('VIDEO_PUBLIC_ID_ALPHABET is not set');
  return new Sqids({
    alphabet,
    minLength: VIDEO_PUBLIC_ID_MIN_LENGTH,
  }).encode([seq]);
}

async function seedUsersAndChannels(ds: DataSource): Promise<void> {
  const hash = await argon2.hash(DEV_PASSWORD);
  for (const user of Object.values(DEV_USERS)) {
    await ds.query(
      `INSERT INTO users (id, email, password, is_confirmed)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (id) DO UPDATE SET email = $2, password = $3, is_confirmed = true`,
      [user.id, user.email, hash],
    );
    await ds.query(
      `INSERT INTO channels (id, name, nickname, user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = $2, nickname = $3`,
      [user.channelId, user.nickname, user.nickname, user.id],
    );
  }
}

async function uploadFixtures(videos: SeedVideo[]): Promise<void> {
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const bucket = process.env.S3_BUCKET || 'streamtube';
  const [video, thumbnail] = await Promise.all([
    readFile(join(FIXTURES_DIR, SAMPLE_VIDEO.file)),
    readFile(join(FIXTURES_DIR, 'sample-thumbnail.jpg')),
  ]);
  try {
    for (const { id } of videos.filter((v) => v.withFiles)) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: videoSourceKey(id),
          Body: video,
          ContentType: 'video/mp4',
        }),
      );
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: videoThumbnailKey(id),
          Body: thumbnail,
          ContentType: 'image/jpeg',
        }),
      );
    }
  } finally {
    client.destroy();
  }
}

async function seedVideos(ds: DataSource): Promise<void> {
  for (const v of DEV_VIDEOS) {
    const ready = v.status === 'READY';
    await ds.query(
      `INSERT INTO videos (id, seq, public_id, channel_id, title, status, original_filename,
         mime_type, size_bytes, storage_key, thumbnail_key, duration_seconds, width, height,
         codec, error_reason)
       VALUES ($1,$2,$3,$4,$5,$6,'sample.mp4','video/mp4',$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         status = $6, title = $5, thumbnail_key = $9, duration_seconds = $10, width = $11,
         height = $12, codec = $13, error_reason = $14, upload_id = NULL`,
      [
        v.id,
        v.seq,
        seedPublicId(v.seq),
        v.channelId,
        v.title,
        v.status,
        SAMPLE_VIDEO.size,
        videoSourceKey(v.id),
        ready ? videoThumbnailKey(v.id) : null,
        ready ? 6 : null,
        ready ? 640 : null,
        ready ? 360 : null,
        ready ? 'h264' : null,
        v.errorReason ?? null,
      ],
    );
  }
}

export async function seedPhase03(ds: DataSource): Promise<void> {
  await seedUsersAndChannels(ds);
  await uploadFixtures(DEV_VIDEOS);
  await seedVideos(ds);
}
