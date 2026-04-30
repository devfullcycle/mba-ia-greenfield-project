import * as crypto from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { RefreshToken } from '../src/auth/entities/refresh-token.entity';
import { VerificationToken } from '../src/auth/entities/verification-token.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let verificationTokenRepository: Repository<VerificationToken>;
  let refreshTokenRepository: Repository<RefreshToken>;

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
    refreshTokenRepository = dataSource.getRepository(RefreshToken);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function captureConfirmationToken(
    email: string,
    password = 'password123',
  ): Promise<string> {
    const authService = app.get(AuthService);
    const mailServiceInstance = (authService as any).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) => {
        capturedToken = t;
      });
    await request(app.getHttpServer()).post('/auth/register').send({ email, password });
    return capturedToken;
  }

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
    it('returns 204 with a valid, unused, non-expired token', async () => {
      const token = await captureConfirmationToken('toconfirm@example.com');

      await request(app.getHttpServer())
        .post('/auth/confirm-email')
        .send({ token })
        .expect(204);
    });

    it('returns 401 with INVALID_TOKEN on an already-used token', async () => {
      const token = await captureConfirmationToken('usedtoken@example.com');

      await request(app.getHttpServer()).post('/auth/confirm-email').send({ token }).expect(204);

      const res = await request(app.getHttpServer())
        .post('/auth/confirm-email')
        .send({ token })
        .expect(401);

      expect(res.body.error).toBe('INVALID_TOKEN');
    });

    it('returns 401 with TOKEN_EXPIRED on an expired token', async () => {
      const token = await captureConfirmationToken('expired@example.com');
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
      const token = await captureConfirmationToken('alreadyconfirmed@example.com');

      await request(app.getHttpServer())
        .post('/auth/confirm-email')
        .send({ token });

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

  describe('JWT Guard', () => {
    async function registerConfirmAndLogin(
      email: string,
      password = 'password123',
    ): Promise<{ access_token: string }> {
      const token = await captureConfirmationToken(email, password);
      await request(app.getHttpServer()).post('/auth/confirm-email').send({ token });
      const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
      return { access_token: res.body.access_token };
    }

    it('returns 401 on GET /auth/me without Authorization header', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('returns 401 on GET /auth/me with an invalid token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer not-a-valid-jwt')
        .expect(401);
    });

    it('returns 200 on GET /auth/me with a valid access token', async () => {
      const { access_token } = await registerConfirmAndLogin('me@example.com');

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);

      expect(res.body.sub).toBeDefined();
      expect(res.body.email).toBe('me@example.com');
    });

    it('GET / is accessible without any Authorization header (@Public)', async () => {
      await request(app.getHttpServer()).get('/').expect(200);
    });

    it('POST /auth/register is accessible without Authorization header (@Public)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'guardtest@example.com', password: 'password123' });
      expect(res.status).toBe(201);
    });
  });

  describe('POST /auth/login', () => {
    async function registerAndConfirmUser(email: string, password: string): Promise<void> {
      const token = await captureConfirmationToken(email, password);
      await request(app.getHttpServer()).post('/auth/confirm-email').send({ token });
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

  describe('POST /auth/refresh', () => {
    async function registerConfirmAndLogin(
      email: string,
      password = 'password123',
    ): Promise<{ access_token: string; refresh_token: string }> {
      const token = await captureConfirmationToken(email, password);
      await request(app.getHttpServer()).post('/auth/confirm-email').send({ token });
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });
      return { access_token: res.body.access_token, refresh_token: res.body.refresh_token };
    }

    it('returns 200 with new access_token and refresh_token on valid refresh token', async () => {
      const { refresh_token } = await registerConfirmAndLogin('refresh@example.com');

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token })
        .expect(200);

      expect(res.body.access_token).toBeDefined();
      expect(res.body.refresh_token).toBeDefined();
      expect(res.body.refresh_token).not.toBe(refresh_token);
    });

    it('returns 401 with INVALID_TOKEN on an unknown refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: 'not-a-real-token' })
        .expect(401);

      expect(res.body.error).toBe('INVALID_TOKEN');
    });

    it('returns 401 with TOKEN_EXPIRED on an expired refresh token', async () => {
      const { refresh_token } = await registerConfirmAndLogin('refreshexp@example.com');
      const tokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');
      await refreshTokenRepository.update({ token_hash: tokenHash }, { expires_at: new Date(0) });

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token })
        .expect(401);

      expect(res.body.error).toBe('TOKEN_EXPIRED');
    });

    it('returns 200 with valid access token when reuse is within grace period', async () => {
      const { refresh_token: token1 } = await registerConfirmAndLogin('grace2@example.com');

      await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: token1 });

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: token1 })
        .expect(200);

      expect(res.body.access_token).toBeDefined();

      const tokenHash = crypto.createHash('sha256').update(token1).digest('hex');
      const revokedRecord = await refreshTokenRepository.findOneBy({ token_hash: tokenHash });
      const activeTokens = await refreshTokenRepository
        .createQueryBuilder('rt')
        .where('rt.family = :family', { family: revokedRecord!.family })
        .andWhere('rt.revoked_at IS NULL')
        .getMany();
      expect(activeTokens.length).toBeGreaterThan(0);
    });

    it('returns 401 with TOKEN_REUSE_DETECTED when reuse is beyond grace period', async () => {
      const { refresh_token: token1 } = await registerConfirmAndLogin('reuse2@example.com');

      await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: token1 });

      const tokenHash = crypto.createHash('sha256').update(token1).digest('hex');
      await refreshTokenRepository.update(
        { token_hash: tokenHash },
        { revoked_at: new Date(Date.now() - 15_000) },
      );

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: token1 })
        .expect(401);

      expect(res.body.error).toBe('TOKEN_REUSE_DETECTED');

      const revokedRecord = await refreshTokenRepository.findOneBy({ token_hash: tokenHash });
      const allInFamily = await refreshTokenRepository.findBy({
        family: revokedRecord!.family,
      });
      const anyActive = allInFamily.some((t) => t.revoked_at === null);
      expect(anyActive).toBe(false);
    });

    it('returns 400 with VALIDATION_ERROR on missing refresh_token field', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({})
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });
});
