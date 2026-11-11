import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Public route that still identifies the caller when possible: a valid Bearer
 * token populates `request.user`; a missing or invalid one means anonymous (never 401).
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
