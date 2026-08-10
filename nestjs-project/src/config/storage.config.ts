import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || 'http://minio:9000',
  accessKey: process.env.STORAGE_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.STORAGE_SECRET_KEY || 'minioadmin',
  bucketVideos: process.env.STORAGE_BUCKET_VIDEOS || 'videos',
  bucketThumbnails: process.env.STORAGE_BUCKET_THUMBNAILS || 'thumbnails',
}));
