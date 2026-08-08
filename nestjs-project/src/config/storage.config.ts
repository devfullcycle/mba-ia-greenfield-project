import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || 'http://storage:9000',
  region: process.env.STORAGE_REGION || 'us-east-1',
  accessKeyId: process.env.STORAGE_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.STORAGE_SECRET_KEY || 'minioadmin',
  bucketVideos: process.env.STORAGE_BUCKET_VIDEOS || 'videos',
  bucketThumbnails: process.env.STORAGE_BUCKET_THUMBNAILS || 'thumbnails',
  forcePathStyle:
    process.env.STORAGE_FORCE_PATH_STYLE === 'false' ? false : true,
}));
