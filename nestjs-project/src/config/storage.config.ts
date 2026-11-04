import { registerAs } from '@nestjs/config';

export const TEN_GIGABYTES_IN_BYTES = 10 * 1024 * 1024 * 1024; // 10,737,418,240
export const DEFAULT_PART_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export default registerAs('storage', () => ({
  endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
  region: process.env.S3_REGION || 'us-east-1',
  accessKey: process.env.S3_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.S3_SECRET_KEY || 'minioadmin',
  bucket: process.env.S3_BUCKET || 'streamtube-videos',
  presignedUrlExpirationSeconds: parseInt(
    process.env.S3_PRESIGNED_URL_EXPIRATION_SECONDS ?? '3600',
    10,
  ),
  partSizeBytes: parseInt(
    process.env.UPLOAD_PART_SIZE_BYTES ?? String(DEFAULT_PART_SIZE_BYTES),
    10,
  ),
  maxUploadSizeBytes: parseInt(
    process.env.MAX_UPLOAD_SIZE_BYTES ?? String(TEN_GIGABYTES_IN_BYTES),
    10,
  ),
}));
