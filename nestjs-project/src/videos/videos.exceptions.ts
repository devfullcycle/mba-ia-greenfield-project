import { DomainException } from '../common/exceptions/domain.exception';

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

export class VideoInvalidStateException extends DomainException {
  constructor() {
    super(
      'VIDEO_INVALID_STATE',
      409,
      'Video is not in a valid state for this operation',
    );
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video is not ready for playback');
  }
}

export class ChannelNotFoundException extends DomainException {
  constructor() {
    super('CHANNEL_NOT_FOUND', 404, 'Channel not found for user');
  }
}
