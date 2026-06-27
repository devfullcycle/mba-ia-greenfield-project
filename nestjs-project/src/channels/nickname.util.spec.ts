import { appendRandomSuffix, sanitizeNickname } from './nickname.util';

describe('sanitizeNickname', () => {
  it('lowercases and strips invalid chars', () => {
    const result = sanitizeNickname('Hello.World+Test');
    expect(result).toBe('helloworldtest');
  });

  it('preserves underscores', () => {
    const result = sanitizeNickname('john_doe');
    expect(result).toBe('john_doe');
  });

  it('preserves digits', () => {
    const result = sanitizeNickname('user123');
    expect(result).toBe('user123');
  });

  it('truncates to 46 characters', () => {
    const long = 'a'.repeat(60);
    const result = sanitizeNickname(long);
    expect(result.length).toBe(46);
  });

  it('returns user_ + 8 random chars when result is empty', () => {
    const result = sanitizeNickname('!!!---');
    expect(result).toMatch(/^user_[a-z0-9]{8}$/);
  });

  it('returns user_ + 8 random chars for empty string', () => {
    const result = sanitizeNickname('');
    expect(result).toMatch(/^user_[a-z0-9]{8}$/);
  });

  it('produces different fallbacks on repeated empty-prefix calls', () => {
    const a = sanitizeNickname('!!!');
    const b = sanitizeNickname('!!!');
    expect(a).toMatch(/^user_[a-z0-9]{8}$/);
    expect(b).toMatch(/^user_[a-z0-9]{8}$/);
  });
});

describe('appendRandomSuffix', () => {
  it('appends underscore and 3 alphanumeric chars', () => {
    const result = appendRandomSuffix('john');
    expect(result).toMatch(/^john_[a-z0-9]{3}$/);
  });

  it('keeps total length at most 50 chars', () => {
    const long = 'a'.repeat(46);
    const result = appendRandomSuffix(long);
    expect(result.length).toBe(50);
  });

  it('truncates base to 46 before appending suffix', () => {
    const long = 'a'.repeat(60);
    const result = appendRandomSuffix(long);
    expect(result.length).toBe(50);
    expect(result).toMatch(/^a{46}_[a-z0-9]{3}$/);
  });

  it('produces only lowercase letters and digits in suffix', () => {
    for (let i = 0; i < 10; i++) {
      const result = appendRandomSuffix('base');
      expect(result).toMatch(/^base_[a-z0-9]{3}$/);
    }
  });
});
