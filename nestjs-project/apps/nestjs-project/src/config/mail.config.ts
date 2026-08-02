import { registerAs } from '@nestjs/config';

export default registerAs('mail', () => ({
  host: process.env.MAIL_HOST || 'mailpit',
  port: parseInt(process.env.MAIL_PORT || '1025', 10),
  from: process.env.MAIL_FROM || '"StreamTube" <noreply@streamtube.com>',
}));
