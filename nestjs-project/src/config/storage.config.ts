import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || 'http://minio:9000',
  region: process.env.STORAGE_REGION || 'us-east-1',
  accessKey: process.env.STORAGE_ACCESS_KEY || '',
  secretKey: process.env.STORAGE_SECRET_KEY || '',
  bucket: process.env.STORAGE_BUCKET || 'streamtube-videos',
  forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE || 'true') === 'true',
  presignExpiration: parseInt(
    process.env.STORAGE_PRESIGN_EXPIRATION || '3600',
    10,
  ),
  uploadPartSize: parseInt(process.env.UPLOAD_PART_SIZE || '10485760', 10),
  uploadMaxSize: parseInt(process.env.UPLOAD_MAX_SIZE || '10737418240', 10),
}));
