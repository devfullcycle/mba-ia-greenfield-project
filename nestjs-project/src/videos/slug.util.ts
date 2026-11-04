import * as crypto from 'node:crypto';

export const VIDEO_SLUG_LENGTH = 11;

/**
 * Generates an 11-character cryptographically random URL-safe Base64URL identifier
 * (`[A-Za-z0-9_-]{11}`, 66 bits of entropy, ~7.37e19 possible combinations).
 */
export function generateVideoSlug(): string {
  return crypto
    .randomBytes(9)
    .toString('base64url')
    .slice(0, VIDEO_SLUG_LENGTH);
}
