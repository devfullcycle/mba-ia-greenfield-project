/** RFC 5987 percent-encoding (encodeURIComponent leaves ' ( ) * unescaped). */
const encodeRfc5987 = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * `attachment` disposition safe for any filename (RFC 6266): an ASCII fallback
 * without quotes, backslashes or control chars, plus the exact UTF-8 name.
 */
export function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}
