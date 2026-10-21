import { applyDecorators, UseGuards } from '@nestjs/common';
import { OptionalAuthGuard } from '../guards/optional-auth.guard';
import { Public } from './public.decorator';

/** Opts out of the global JWT guard but still resolves the user when a valid token is sent. */
export const OptionalAuth = () =>
  applyDecorators(Public(), UseGuards(OptionalAuthGuard));
