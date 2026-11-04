import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import {
  DomainException,
  InvalidByteRangeException,
} from '../exceptions/domain.exception';

@Catch(DomainException)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (
      exception instanceof InvalidByteRangeException &&
      typeof exception.totalSizeBytes === 'number' &&
      typeof response.setHeader === 'function'
    ) {
      response.setHeader(
        'Content-Range',
        `bytes */${exception.totalSizeBytes}`,
      );
    }

    response.status(exception.httpStatus).json({
      statusCode: exception.httpStatus,
      error: exception.errorCode,
      message: exception.message,
    });
  }
}
