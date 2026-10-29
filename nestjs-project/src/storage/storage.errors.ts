/**
 * The storage engine refused to complete a multipart upload because of the
 * client-supplied part list (unknown upload, wrong ETag, parts out of order,
 * part too small). Transport-agnostic so callers can map it to a domain error.
 */
export class MultipartUploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultipartUploadRejectedError';
  }
}
