import { registerAs } from '@nestjs/config';

const DEFAULT_PART_SIZE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024 * 1024;

export default registerAs('storage', () => ({
  endpoint: process.env.S3_ENDPOINT!,
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT!,
  bucket: process.env.S3_BUCKET || 'streamtube',
  region: process.env.S3_REGION || 'us-east-1',
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  presignUploadTtlSeconds: parseInt(
    process.env.S3_PRESIGN_UPLOAD_TTL_SECONDS || '3600',
    10,
  ),
  presignReadTtlSeconds: parseInt(
    process.env.S3_PRESIGN_READ_TTL_SECONDS || '14400',
    10,
  ),
  partSizeBytes: parseInt(
    process.env.S3_PART_SIZE_BYTES || String(DEFAULT_PART_SIZE_BYTES),
    10,
  ),
  maxSizeBytes: parseInt(
    process.env.S3_MAX_SIZE_BYTES || String(DEFAULT_MAX_SIZE_BYTES),
    10,
  ),
}));
