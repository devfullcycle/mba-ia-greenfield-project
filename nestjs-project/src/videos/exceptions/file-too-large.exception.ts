import { DomainException } from '../../common/exceptions/domain.exception';

export class FileTooLargeException extends DomainException {
  constructor() {
    super('FILE_TOO_LARGE', 400, 'File exceeds the 10GB upload limit');
  }
}
