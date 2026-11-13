import { DomainException } from '../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class VideoUploadForbiddenException extends DomainException {
  constructor() {
    super('VIDEO_UPLOAD_FORBIDDEN', 403, 'You do not own this video');
  }
}

export class VideoUploadConflictException extends DomainException {
  constructor() {
    super('VIDEO_UPLOAD_CONFLICT', 409, 'Video upload is already in progress');
  }
}

export class InvalidVideoUploadException extends DomainException {
  constructor() {
    super('VIDEO_UPLOAD_INVALID', 400, 'Invalid video upload');
  }
}
