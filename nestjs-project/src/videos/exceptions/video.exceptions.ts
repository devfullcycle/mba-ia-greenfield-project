import { DomainException } from '../../common/exceptions/domain.exception';

export class FileTooLargeException extends DomainException {
  constructor() {
    super('FILE_TOO_LARGE', 400, 'File exceeds the 10GB limit');
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class ForbiddenVideoAccessException extends DomainException {
  constructor() {
    super('FORBIDDEN', 403, 'You do not own this video');
  }
}

export class UploadAlreadyCompletedException extends DomainException {
  constructor() {
    super('UPLOAD_ALREADY_COMPLETED', 409, 'Upload already completed');
  }
}

export class MultipartCompletionFailedException extends DomainException {
  constructor() {
    super(
      'MULTIPART_COMPLETION_FAILED',
      502,
      'Failed to finalize upload with storage',
    );
  }
}

export class InvalidUploadStateException extends DomainException {
  constructor() {
    super('INVALID_UPLOAD_STATE', 409, 'Video is not in an abortable state');
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video is not ready for playback');
  }
}
