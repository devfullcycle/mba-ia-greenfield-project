import { randomBytes } from 'crypto';

// Max nickname base length reserves 4 chars for the '_xxx' suffix (total column limit: 50)
const MAX_BASE_LENGTH = 46;

function randomHex(length: number): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

export function sanitizeNickname(emailPrefix: string): string {
  const sanitized = emailPrefix
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, MAX_BASE_LENGTH);
  if (!sanitized) {
    return 'user_' + randomHex(8);
  }
  return sanitized;
}

export function appendRandomSuffix(nickname: string): string {
  const base = nickname.slice(0, MAX_BASE_LENGTH);
  return base + '_' + randomHex(3);
}
