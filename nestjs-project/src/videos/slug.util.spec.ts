import { generateVideoSlug, VIDEO_SLUG_LENGTH } from './slug.util';

describe('generateVideoSlug', () => {
  it('generates an 11-character URL-safe Base64URL string', () => {
    const slug = generateVideoSlug();
    expect(slug).toHaveLength(VIDEO_SLUG_LENGTH);
    expect(slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  it('produces unique identifiers across 5,000 consecutive calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      seen.add(generateVideoSlug());
    }
    expect(seen.size).toBe(5000);
  });
});
