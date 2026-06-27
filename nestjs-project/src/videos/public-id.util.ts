import { randomBytes } from 'node:crypto';

/**
 * Generates a short, URL-safe public identifier for a video.
 * 8 random bytes encoded as base64url yields an 11-character handle.
 */
export function generatePublicId(): string {
  return randomBytes(8).toString('base64url');
}
