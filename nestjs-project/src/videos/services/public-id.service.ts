import { Injectable } from '@nestjs/common';
import { customAlphabet } from 'nanoid';

// URL-safe, collision-resistant alphabet (no '-'/'_' to avoid router/URL edge cases).
const ALPHABET =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ID_LENGTH = 11;

/**
 * Generates the public, URL-facing identifier of a video. Uniqueness is
 * guaranteed by the UNIQUE constraint on `videos.public_id`; the retry loop
 * here is the safety net against the (astronomically unlikely) collision.
 */
@Injectable()
export class PublicIdService {
  private readonly nano = customAlphabet(ALPHABET, ID_LENGTH);

  newId(): string {
    return this.nano();
  }

  async generateUnique(
    exists: (id: string) => Promise<boolean>,
    maxAttempts = 5,
  ): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const id = this.nano();
      if (!(await exists(id))) {
        return id;
      }
    }
    throw new Error(
      `Could not generate a unique public_id after ${maxAttempts} attempts`,
    );
  }
}
