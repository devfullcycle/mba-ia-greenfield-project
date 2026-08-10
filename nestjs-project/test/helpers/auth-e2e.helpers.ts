import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../../src/auth/auth.service';

export async function captureConfirmationToken(
  app: INestApplication<App>,
  email: string,
  password = 'password123',
): Promise<string> {
  const authService = app.get(AuthService);
  const mailServiceInstance = (authService as any).mailService;
  let capturedToken = '';
  jest
    .spyOn(mailServiceInstance, 'sendConfirmationEmail')
    .mockImplementationOnce((_e: string, _n: string, t: string) => {
      capturedToken = t;
    });
  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password });
  return capturedToken;
}

export async function registerConfirmAndLogin(
  app: INestApplication<App>,
  email: string,
  password = 'password123',
): Promise<{ access_token: string; refresh_token: string }> {
  const token = await captureConfirmationToken(app, email, password);
  await request(app.getHttpServer())
    .get('/auth/confirm-email')
    .query({ token });
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password });
  return {
    access_token: res.body.access_token,
    refresh_token: res.body.refresh_token,
  };
}
