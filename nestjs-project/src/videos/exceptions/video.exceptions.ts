import { DomainException } from '../../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class NotVideoOwnerException extends DomainException {
  constructor() {
    super('NOT_VIDEO_OWNER', 403, 'You do not own this video');
  }
}

export class InvalidVideoStateException extends DomainException {
  constructor(message = 'Video is not in a valid state for this operation') {
    super('INVALID_VIDEO_STATE', 409, message);
  }
}

export class FileTooLargeException extends DomainException {
  constructor() {
    super('FILE_TOO_LARGE', 413, 'File exceeds the maximum allowed size');
  }
}

export class UnsupportedMediaTypeException extends DomainException {
  constructor() {
    super('UNSUPPORTED_MEDIA_TYPE', 415, 'Unsupported media type');
  }
}

export class UploadIncompleteException extends DomainException {
  constructor() {
    super('UPLOAD_INCOMPLETE', 422, 'Upload could not be finalized');
  }
}

export class RangeNotSatisfiableException extends DomainException {
  constructor() {
    super('RANGE_NOT_SATISFIABLE', 416, 'Requested range not satisfiable');
  }
}
