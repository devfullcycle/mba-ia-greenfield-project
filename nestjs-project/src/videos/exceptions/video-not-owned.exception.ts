import { DomainException } from '../../common/exceptions/domain.exception';

export class VideoNotOwnedException extends DomainException {
  constructor() {
    super('VIDEO_NOT_OWNED', 403, 'Video does not belong to your channel');
  }
}
