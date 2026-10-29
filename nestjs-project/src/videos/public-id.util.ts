import { randomBytes } from 'crypto';
import { PUBLIC_ID_LENGTH } from './videos.constants';

/**
 * Generates a short, URL-safe, unguessable id. 8 random bytes encode to
 * exactly 11 base64url characters, so no padding or truncation is needed.
 */
export function generatePublicId(): string {
  return randomBytes(8).toString('base64url').slice(0, PUBLIC_ID_LENGTH);
}
