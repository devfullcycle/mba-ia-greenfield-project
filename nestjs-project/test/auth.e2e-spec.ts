import * as crypto from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { VerificationToken } from '../src/auth/entities/verification-token.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let verificationTokenRepository: Repository<VerificationToken>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new DomainExceptionFilter(), new ValidationExceptionFilter());
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    verificationTokenRepository = dataSource.getRepository(VerificationToken);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  describe('POST /auth/register', () => {
    it('returns 201 with { id, email } on valid registration', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'user@example.com', password: 'password123' })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.email).toBe('user@example.com');
    });

    it('returns 409 with EMAIL_ALREADY_EXISTS on duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'dup@example.com', password: 'password123' });

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'dup@example.com', password: 'password456' })
        .expect(409);

      expect(res.body.error).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('returns 400 with VALIDATION_ERROR on missing email', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ password: 'password123' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 with VALIDATION_ERROR on invalid email format', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'password123' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 with VALIDATION_ERROR when password is too short', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'user@example.com', password: 'short' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 with VALIDATION_ERROR on unknown extra fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'user@example.com', password: 'password123', admin: true })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/confirm-email', () => {
    async function registerAndCaptureToken(email: string): Promise<string> {
      let capturedToken = '';
      const authService = app.get(AuthService);
      const mailServiceInstance = (authService as any).mailService;
      jest
        .spyOn(mailServiceInstance, 'sendConfirmationEmail')
        .mockImplementationOnce(async (_e: string, _n: string, t: string) => {
          capturedToken = t;
        });

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'password123' });

      return capturedToken;
    }

    it('returns 204 with a valid, unused, non-expired token', async () => {
      const token = await registerAndCaptureToken('toconfirm@example.com');

      await request(app.getHttpServer())
        .post('/auth/confirm-email')
        .send({ token })
        .expect(204);
    });

    it('returns 401 with INVALID_TOKEN on an already-used token', async () => {
      const token = await registerAndCaptureToken('usedtoken@example.com');

      await request(app.getHttpServer()).post('/auth/confirm-email').send({ token }).expect(204);

      const res = await request(app.getHttpServer())
        .post('/auth/confirm-email')
        .send({ token })
        .expect(401);

      expect(res.body.error).toBe('INVALID_TOKEN');
    });

    it('returns 401 with TOKEN_EXPIRED on an expired token', async () => {
      const token = await registerAndCaptureToken('expired@example.com');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await verificationTokenRepository.update({ token_hash: tokenHash }, { expires_at: new Date(0) });

      const res = await request(app.getHttpServer())
        .post('/auth/confirm-email')
        .send({ token })
        .expect(401);

      expect(res.body.error).toBe('TOKEN_EXPIRED');
    });

    it('returns 400 with VALIDATION_ERROR on missing token field', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/confirm-email')
        .send({})
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/resend-confirmation', () => {
    it('returns 204 for a registered, unconfirmed email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'resend@example.com', password: 'password123' });

      await request(app.getHttpServer())
        .post('/auth/resend-confirmation')
        .send({ email: 'resend@example.com' })
        .expect(204);
    });

    it('returns 204 for a non-existent email (no leak)', async () => {
      await request(app.getHttpServer())
        .post('/auth/resend-confirmation')
        .send({ email: 'nobody@example.com' })
        .expect(204);
    });

    it('returns 204 for an already-confirmed email (no leak)', async () => {
      let capturedToken = '';
      const authService = app.get(AuthService);
      const mailServiceInstance = (authService as any).mailService;
      jest.spyOn(mailServiceInstance, 'sendConfirmationEmail').mockImplementationOnce(
        async (_e: string, _n: string, t: string) => { capturedToken = t; },
      );

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'alreadyconfirmed@example.com', password: 'password123' });

      await request(app.getHttpServer())
        .post('/auth/confirm-email')
        .send({ token: capturedToken });

      await request(app.getHttpServer())
        .post('/auth/resend-confirmation')
        .send({ email: 'alreadyconfirmed@example.com' })
        .expect(204);
    });

    it('returns 400 with VALIDATION_ERROR on invalid email format', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/resend-confirmation')
        .send({ email: 'not-an-email' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/login', () => {
    async function registerAndConfirmUser(email: string, password: string): Promise<void> {
      const authService = app.get(AuthService);
      const mailServiceInstance = (authService as any).mailService;
      let capturedToken = '';
      jest.spyOn(mailServiceInstance, 'sendConfirmationEmail').mockImplementationOnce(
        async (_e: string, _n: string, t: string) => { capturedToken = t; },
      );

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password });

      await request(app.getHttpServer())
        .post('/auth/confirm-email')
        .send({ token: capturedToken });
    }

    it('returns 200 with access_token and refresh_token on valid credentials', async () => {
      await registerAndConfirmUser('login@example.com', 'password123');

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'login@example.com', password: 'password123' })
        .expect(200);

      expect(res.body.access_token).toBeDefined();
      expect(res.body.refresh_token).toBeDefined();
      expect(typeof res.body.access_token).toBe('string');
      expect(typeof res.body.refresh_token).toBe('string');
    });

    it('returns 401 with INVALID_CREDENTIALS on wrong password', async () => {
      await registerAndConfirmUser('wrongpass@example.com', 'password123');

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'wrongpass@example.com', password: 'incorrect' })
        .expect(401);

      expect(res.body.error).toBe('INVALID_CREDENTIALS');
    });

    it('returns 401 with INVALID_CREDENTIALS on unknown email', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'password123' })
        .expect(401);

      expect(res.body.error).toBe('INVALID_CREDENTIALS');
    });

    it('returns 403 with EMAIL_NOT_CONFIRMED when user is not confirmed', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'unconfirmed@example.com', password: 'password123' });

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'unconfirmed@example.com', password: 'password123' })
        .expect(403);

      expect(res.body.error).toBe('EMAIL_NOT_CONFIRMED');
    });

    it('returns 400 with VALIDATION_ERROR on missing password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'user@example.com' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });
});
