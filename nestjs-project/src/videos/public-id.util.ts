import { nanoid } from 'nanoid';

export const PUBLIC_ID_LENGTH = 11;

export function generatePublicId(): string {
  return nanoid(PUBLIC_ID_LENGTH);
}
