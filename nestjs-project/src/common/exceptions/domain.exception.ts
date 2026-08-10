export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}

export class VideoNotFoundException extends DomainException {
  constructor(id: string) {
    super('VIDEO_NOT_FOUND', 404, `Video ${id} not found`);
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video is not ready for streaming');
  }
}

export class VideoNotDraftException extends DomainException {
  constructor() {
    super('VIDEO_NOT_DRAFT', 400, 'Video is not in draft status');
  }
}

export class VideoOwnershipException extends DomainException {
  constructor() {
    super('VIDEO_FORBIDDEN', 403, 'You do not own this video');
  }
}

export class ChannelRequiredException extends DomainException {
  constructor() {
    super('CHANNEL_REQUIRED', 403, 'You must have a channel to upload videos');
  }
}

export class VideoUploadEnqueueException extends DomainException {
  constructor() {
    super(
      'UPLOAD_ENQUEUE_FAILED',
      500,
      'Failed to enqueue video processing job',
    );
  }
}

export class VideoRangeNotSatisfiableException extends DomainException {
  constructor() {
    super('RANGE_NOT_SATISFIABLE', 416, 'Range not satisfiable');
  }
}
