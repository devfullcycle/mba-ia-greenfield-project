export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  /** Extra HTTP headers the response must carry (none by default). */
  get headers(): Record<string, string> {
    return {};
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
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class VideoNotInDraftException extends DomainException {
  constructor() {
    super('VIDEO_NOT_IN_DRAFT', 409, 'Video is not in DRAFT status');
  }
}

export class InvalidUploadPartsException extends DomainException {
  constructor() {
    super('INVALID_UPLOAD_PARTS', 400, 'Upload parts are invalid');
  }
}

export class RangeNotSatisfiableException extends DomainException {
  constructor(public readonly objectSize: number) {
    super('RANGE_NOT_SATISFIABLE', 416, 'Requested range is not satisfiable');
  }

  override get headers(): Record<string, string> {
    return { 'Content-Range': `bytes */${this.objectSize}` };
  }
}
