import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || 'minio',
  port: parseInt(process.env.STORAGE_PORT || '9000', 10),
  accessKey: process.env.STORAGE_ACCESS_KEY!,
  secretKey: process.env.STORAGE_SECRET_KEY!,
  bucketVideos: process.env.STORAGE_BUCKET_VIDEOS || 'videos',
  bucketThumbnails: process.env.STORAGE_BUCKET_THUMBNAILS || 'thumbnails',
  useSsl: process.env.STORAGE_USE_SSL === 'true',
}));
