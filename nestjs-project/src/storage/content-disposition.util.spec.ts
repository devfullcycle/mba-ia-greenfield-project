import { attachmentDisposition } from './content-disposition.util';

describe('attachmentDisposition', () => {
  it('should keep a plain ASCII name in the simple form', () => {
    expect(attachmentDisposition('clip.mp4')).toBe(
      'attachment; filename="clip.mp4"',
    );
  });

  it('should keep spaces and common punctuation', () => {
    expect(attachmentDisposition('My Holiday (2026), part 1.mp4')).toBe(
      'attachment; filename="My Holiday (2026), part 1.mp4"',
    );
  });

  it('should neutralise quotes, backslashes and path separators', () => {
    expect(attachmentDisposition('a"b\\c/d.mp4')).toBe(
      'attachment; filename="a_b_c_d.mp4"',
    );
  });

  it('should neutralise control characters that could split the header', () => {
    expect(attachmentDisposition('a\r\nSet-Cookie: x=1.mp4')).toBe(
      'attachment; filename="a__Set-Cookie: x=1.mp4"',
    );
  });

  it('should add an ASCII fallback and an RFC 5987 filename* for non-ASCII names', () => {
    expect(attachmentDisposition('vídeo férias.mp4')).toBe(
      `attachment; filename="v_deo f_rias.mp4"; filename*=UTF-8''v%C3%ADdeo%20f%C3%A9rias.mp4`,
    );
  });

  it('should percent-encode the characters RFC 5987 reserves, such as the apostrophe', () => {
    expect(attachmentDisposition("café's.mp4")).toContain(
      "filename*=UTF-8''caf%C3%A9%27s.mp4",
    );
  });
});
