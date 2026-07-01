import { DomainException } from '../../common/exceptions/domain.exception';

export class UnsupportedMediaTypeException extends DomainException {
  constructor() {
    super('UNSUPPORTED_MEDIA_TYPE', 400, 'Video format is not supported');
  }
}

export class FileTooLargeException extends DomainException {
  constructor() {
    super(
      'FILE_TOO_LARGE',
      400,
      'File exceeds the maximum allowed size of 10GB',
    );
  }
}

export class UploadPartInvalidException extends DomainException {
  constructor() {
    super('UPLOAD_PART_INVALID', 400, 'Invalid part number');
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class InvalidVideoStatusTransitionException extends DomainException {
  constructor() {
    super(
      'INVALID_VIDEO_STATUS_TRANSITION',
      409,
      'Video is not in a valid state for this operation',
    );
  }
}
