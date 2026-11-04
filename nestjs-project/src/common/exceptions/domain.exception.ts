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

export class ChannelNotFoundException extends DomainException {
  constructor() {
    super('CHANNEL_NOT_FOUND', 404, 'Channel not found for user');
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class VideoForbiddenException extends DomainException {
  constructor() {
    super('VIDEO_FORBIDDEN', 403, 'You do not own this video');
  }
}

export class VideoFileTooLargeException extends DomainException {
  constructor() {
    super(
      'VIDEO_FILE_TOO_LARGE',
      413,
      'Video file exceeds the maximum allowed size of 10GB',
    );
  }
}

export class UnsupportedVideoFormatException extends DomainException {
  constructor() {
    super('UNSUPPORTED_VIDEO_FORMAT', 400, 'Unsupported video MIME type');
  }
}

export class VideoInvalidStateException extends DomainException {
  constructor(message = 'Video is not in a valid state for this operation') {
    super('VIDEO_INVALID_STATE', 409, message);
  }
}

export class VideoUploadIncompleteException extends DomainException {
  constructor() {
    super(
      'VIDEO_UPLOAD_INCOMPLETE',
      400,
      'Uploaded video object was not found in storage',
    );
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super(
      'VIDEO_NOT_READY',
      409,
      'Video is not ready for playback or download',
    );
  }
}

export class InvalidByteRangeException extends DomainException {
  constructor(public readonly totalSizeBytes?: number) {
    super('INVALID_BYTE_RANGE', 416, 'Requested byte range is not satisfiable');
  }
}
