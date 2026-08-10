import { DomainException } from '../../common/exceptions/domain.exception';

export class StorageErrorException extends DomainException {
  constructor() {
    super('STORAGE_ERROR', 502, 'Storage operation failed');
  }
}
