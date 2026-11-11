import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  publicIdAlphabet: process.env.VIDEO_PUBLIC_ID_ALPHABET!,
  reconcilerEnabled: process.env.VIDEO_RECONCILER_ENABLED !== 'false',
}));
