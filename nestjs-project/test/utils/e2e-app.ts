import { type INestApplication, ValidationPipe } from '@nestjs/common';
import {
  Test,
  type TestingModule,
  type TestingModuleBuilder,
} from '@nestjs/testing';
import {
  ThrottlerStorage,
  type ThrottlerStorageService,
} from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module';
import { JSON_BODY_LIMIT } from '../../src/common/http/body-limit';
import { AuthService } from '../../src/auth/auth.service';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';

export interface E2eApp {
  app: INestApplication<App>;
  moduleFixture: TestingModule;
}

/** Boots AppModule with the same global pipes/filters `main.ts` applies. */
export async function createE2eApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (
    builder,
  ) => builder,
): Promise<E2eApp> {
  const moduleFixture = await customize(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();
  return { app: app as unknown as INestApplication<App>, moduleFixture };
}

/** Auth routes are rate limited (10 req/min); reset between tests that log users in. */
export function resetThrottler(moduleFixture: TestingModule): void {
  moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
}

/** Registers, confirms (capturing the emailed token) and logs a user in; returns the access token. */
export async function registerConfirmAndLogin(
  app: INestApplication<App>,
  email: string,
  password = 'password123',
): Promise<string> {
  const mailService = app.get(AuthService)['mailService'];
  let confirmationToken = '';
  jest
    .spyOn(mailService, 'sendConfirmationEmail')
    .mockImplementationOnce((_email: string, _name: string, token: string) => {
      confirmationToken = token;
      return Promise.resolve();
    });

  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  await request(app.getHttpServer())
    .get('/auth/confirm-email')
    .query({ token: confirmationToken })
    .expect(204);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  return (login.body as { access_token: string }).access_token;
}
