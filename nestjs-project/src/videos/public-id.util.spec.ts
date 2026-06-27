import { generatePublicId } from './public-id.util';

describe('generatePublicId', () => {
  it('produces only URL-safe characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePublicId()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('produces an 11-character handle (8 bytes base64url)', () => {
    expect(generatePublicId()).toHaveLength(11);
  });

  it('produces unique values across many calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      ids.add(generatePublicId());
    }
    expect(ids.size).toBe(10000);
  });
});
