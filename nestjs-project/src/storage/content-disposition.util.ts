const NON_ASCII = /[^ -~]/g;

const DELETE_CHARACTER = 0x7f;
const FIRST_PRINTABLE = 0x20;

function isUnsafe(char: string): boolean {
  const code = char.codePointAt(0)!;
  return (
    code < FIRST_PRINTABLE ||
    code === DELETE_CHARACTER ||
    char === '"' ||
    char === '\\' ||
    char === '/'
  );
}

function neutralise(filename: string): string {
  return Array.from(filename, (char) => (isUnsafe(char) ? '_' : char)).join('');
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Builds a `Content-Disposition: attachment` value for a user-supplied file
 * name. Control characters, quotes and path separators are neutralised, and a
 * non-ASCII name gets an ASCII fallback plus an RFC 5987 `filename*` so the
 * original name survives in every browser.
 */
export function attachmentDisposition(filename: string): string {
  const safe = neutralise(filename);
  const ascii = safe.replace(NON_ASCII, '_');
  if (ascii === safe) {
    return `attachment; filename="${safe}"`;
  }
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(safe)}`;
}
