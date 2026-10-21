import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT as string,
  publicEndpoint: process.env.STORAGE_PUBLIC_ENDPOINT as string,
  bucket: process.env.STORAGE_BUCKET as string,
  accessKey: process.env.STORAGE_ACCESS_KEY as string,
  secretKey: process.env.STORAGE_SECRET_KEY as string,
  region: process.env.STORAGE_REGION || 'us-east-1',
  forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== 'false',
}));
