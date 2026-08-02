import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || 'http://minio:9000',
  region: process.env.STORAGE_REGION || 'us-east-1',
  accessKey: process.env.STORAGE_ACCESS_KEY!,
  secretKey: process.env.STORAGE_SECRET_KEY!,
  bucketVideos: process.env.STORAGE_BUCKET_VIDEOS || 'videos',
  forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== 'false',
  multipartPartSizeMb: parseInt(
    process.env.STORAGE_MULTIPART_PART_SIZE_MB || '100',
    10,
  ),
  presignedUrlExpirationSeconds: parseInt(
    process.env.STORAGE_PRESIGNED_URL_EXPIRATION_SECONDS || '3600',
    10,
  ),
}));
