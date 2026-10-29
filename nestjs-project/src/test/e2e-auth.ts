import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import type { MailService } from '../mail/mail.service';

interface LoginBody {
  access_token: string;
}

/**
 * Registers a user, confirms the email (capturing the token from the mail
 * service instead of reading Mailpit) and logs in. Returns the access token.
 */
export async function registerConfirmAndLogin(
  app: INestApplication<App>,
  email: string,
  password = 'password123',
): Promise<string> {
  const authService = app.get(AuthService);
  const mailService = (authService as unknown as { mailService: MailService })
    .mailService;
  let confirmationToken = '';
  jest
    .spyOn(mailService, 'sendConfirmationEmail')
    .mockImplementationOnce((_email: string, _name: string, token: string) => {
      confirmationToken = token;
      return Promise.resolve();
    });
  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password });
  await request(app.getHttpServer())
    .get('/auth/confirm-email')
    .query({ token: confirmationToken });
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password });
  return (res.body as LoginBody).access_token;
}
