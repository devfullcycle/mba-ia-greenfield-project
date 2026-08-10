import { DomainException } from '../../common/exceptions/domain.exception';

export class InvalidVideoStatusException extends DomainException {
  constructor() {
    super(
      'INVALID_VIDEO_STATUS',
      409,
      'Video is not in the required status for this operation',
    );
  }
}
