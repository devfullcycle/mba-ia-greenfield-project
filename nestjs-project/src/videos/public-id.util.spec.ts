import { generatePublicId } from './public-id.util';
import { PUBLIC_ID_LENGTH } from './videos.constants';

describe('generatePublicId', () => {
  it('should return exactly 11 characters', () => {
    expect(generatePublicId()).toHaveLength(PUBLIC_ID_LENGTH);
  });

  it('should only use the URL-safe base64 alphabet', () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePublicId()).toMatch(/^[A-Za-z0-9_-]{11}$/);
    }
  });

  it('should not repeat across many generations', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generatePublicId()));

    expect(ids.size).toBe(1000);
  });
});
