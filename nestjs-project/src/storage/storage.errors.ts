import { S3ServiceException } from '@aws-sdk/client-s3';
import { S3_ERROR_NAMES } from './storage.constants';

/**
 * Storage-layer errors. Deliberately not HTTP exceptions: consumers (API
 * services, worker) translate them into their own domain errors.
 */
export abstract class StorageError extends Error {
  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class StorageInvalidPartsError extends StorageError {
  constructor(cause?: unknown) {
    super('Storage rejected the multipart upload parts', { cause });
  }
}

export class StorageInvalidRangeError extends StorageError {
  constructor(cause?: unknown) {
    super('Requested range is not satisfiable', { cause });
  }
}

export class StorageNotFoundError extends StorageError {
  constructor(cause?: unknown) {
    super('Storage object not found', { cause });
  }
}

const matches = (names: readonly string[], err: S3ServiceException): boolean =>
  names.includes(err.name);

/** Translates known SDK errors into typed storage errors; rethrows anything else unchanged. */
export function toStorageError(err: unknown): unknown {
  if (!(err instanceof S3ServiceException)) return err;
  if (matches(S3_ERROR_NAMES.INVALID_PARTS, err)) {
    return new StorageInvalidPartsError(err);
  }
  if (matches(S3_ERROR_NAMES.INVALID_RANGE, err)) {
    return new StorageInvalidRangeError(err);
  }
  if (matches(S3_ERROR_NAMES.NOT_FOUND, err)) {
    return new StorageNotFoundError(err);
  }
  return err;
}
