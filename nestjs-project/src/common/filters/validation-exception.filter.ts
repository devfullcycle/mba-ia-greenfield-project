import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';

@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const exceptionResponse = exception.getResponse() as Record<string, unknown>;

    const raw = exceptionResponse['message'];
    const message = Array.isArray(raw) ? raw : [raw];

    response.status(400).json({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message,
    });
  }
}
