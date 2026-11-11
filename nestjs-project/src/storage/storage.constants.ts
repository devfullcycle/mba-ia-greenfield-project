export const S3_INTERNAL_CLIENT = Symbol('S3_INTERNAL_CLIENT');
export const S3_PUBLIC_CLIENT = Symbol('S3_PUBLIC_CLIENT');

export const S3_ERROR_NAMES = {
  INVALID_PARTS: [
    'InvalidPart',
    'InvalidPartOrder',
    'EntityTooSmall',
    'NoSuchUpload',
  ],
  INVALID_RANGE: ['InvalidRange'],
  NOT_FOUND: ['NoSuchKey', 'NotFound'],
  UPLOAD_GONE: ['NoSuchUpload'],
} as const;
