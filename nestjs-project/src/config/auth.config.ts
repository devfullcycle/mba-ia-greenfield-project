import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET!,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
  jwtAccessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
  jwtRefreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  confirmationTokenExpirationHours: parseInt(
    process.env.CONFIRMATION_TOKEN_EXPIRATION_HOURS || '1',
    10,
  ),
  passwordResetTokenExpirationHours: parseInt(
    process.env.PASSWORD_RESET_TOKEN_EXPIRATION_HOURS || '1',
    10,
  ),
}));
