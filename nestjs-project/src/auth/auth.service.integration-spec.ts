import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigType } from '@nestjs/config';
import type { StringValue } from 'ms';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import appConfig from '../config/app.config';
import authConfig from '../config/auth.config';
import mailConfig from '../config/mail.config';
import * as argon2 from 'argon2';
import {
  EmailAlreadyExistsException,
  InvalidCredentialsException,
  InvalidTokenException,
  TokenExpiredException,
  TokenReuseDetectedException,
} from '../common/exceptions/domain.exception';
import { MailModule } from '../mail/mail.module';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { clearMailpitMessages } from '../test/mailpit';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import {
  VerificationToken,
  VerificationTokenType,
} from './entities/verification-token.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken];

async function createAuthTestModule(): Promise<TestingModule> {
  const ds = createTestDataSource(ALL_ENTITIES);
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [appConfig, authConfig, mailConfig],
      }),
      TypeOrmModule.forRoot(ds.options),
      TypeOrmModule.forFeature([
        User,
        Channel,
        VerificationToken,
        RefreshToken,
      ]),
      JwtModule.registerAsync({
        inject: [authConfig.KEY],
        useFactory: (cfg: ConfigType<typeof authConfig>) => ({
          secret: cfg.jwtSecret,
          signOptions: { expiresIn: cfg.jwtAccessExpiration as StringValue },
        }),
      }),
      UsersModule,
      MailModule,
    ],
    providers: [AuthService],
  }).compile();
}

function captureConfirmationToken(authService: AuthService): Promise<string> {
  return new Promise((resolve) => {
    const mailServiceInstance = (authService as any).mailService;
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) =>
        resolve(t),
      );
  });
}

async function registerConfirmAndLogin(
  authService: AuthService,
  email: string,
  password: string,
): Promise<{ userId: string; refreshToken: string }> {
  const capturePromise = captureConfirmationToken(authService);
  const { id: userId } = await authService.register({ email, password });
  const confirmToken = await capturePromise;
  await authService.confirm(confirmToken);
  const { refresh_token: refreshToken } = await authService.login({
    email,
    password,
  });
  return { userId, refreshToken };
}

describe('AuthService — register (integration)', () => {
  let authService: AuthService;
  let dataSource: DataSource;
  let verificationTokenRepository: Repository<VerificationToken>;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    const module = await createAuthTestModule();
    authService = module.get(AuthService);
    dataSource = module.get(DataSource);
    verificationTokenRepository = dataSource.getRepository(VerificationToken);
    userRepository = dataSource.getRepository(User);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await clearMailpitMessages();
  });

  it('persists a user, channel, and verification token on successful registration', async () => {
    const result = await authService.register({
      email: 'newuser@example.com',
      password: 'securepassword',
    });

    expect(result.id).toBeDefined();
    expect(result.email).toBe('newuser@example.com');

    const user = await userRepository.findOneBy({ id: result.id });
    expect(user).not.toBeNull();

    const token = await verificationTokenRepository.findOneBy({
      user_id: result.id,
    });
    expect(token).not.toBeNull();
    expect(token!.type).toBe(VerificationTokenType.EMAIL_CONFIRMATION);
    expect(token!.used_at).toBeNull();
    expect(token!.expires_at).toBeInstanceOf(Date);
  });

  it('stores a valid SHA-256 hex hash in verification_tokens', async () => {
    const result = await authService.register({
      email: 'hash@example.com',
      password: 'securepassword',
    });

    const token = await verificationTokenRepository.findOneBy({
      user_id: result.id,
    });
    expect(token).not.toBeNull();
    expect(token!.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('throws EmailAlreadyExistsException on duplicate email', async () => {
    await authService.register({
      email: 'dup@example.com',
      password: 'password123',
    });

    await expect(
      authService.register({
        email: 'dup@example.com',
        password: 'password456',
      }),
    ).rejects.toThrow(EmailAlreadyExistsException);
  });

  it('confirmation token hash matches sha256 of raw token delivered by mail service', async () => {
    const capturePromise = captureConfirmationToken(authService);
    const result = await authService.register({
      email: 'verify@example.com',
      password: 'password123',
    });
    const capturedRawToken = await capturePromise;

    const expectedHash = crypto
      .createHash('sha256')
      .update(capturedRawToken)
      .digest('hex');

    const token = await verificationTokenRepository.findOneBy({
      user_id: result.id,
    });
    expect(token!.token_hash).toBe(expectedHash);
  });
});

describe('AuthService — confirm (integration)', () => {
  let authService: AuthService;
  let dataSource: DataSource;
  let verificationTokenRepository: Repository<VerificationToken>;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    const module = await createAuthTestModule();
    authService = module.get(AuthService);
    dataSource = module.get(DataSource);
    verificationTokenRepository = dataSource.getRepository(VerificationToken);
    userRepository = dataSource.getRepository(User);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await clearMailpitMessages();
  });

  it('sets is_confirmed = true and used_at on valid token', async () => {
    const capturePromise = captureConfirmationToken(authService);
    const { id: userId } = await authService.register({
      email: 'confirm@example.com',
      password: 'password123',
    });
    const capturedToken = await capturePromise;

    await authService.confirm(capturedToken);

    const user = await userRepository.findOneBy({ id: userId });
    expect(user!.is_confirmed).toBe(true);

    const token = await verificationTokenRepository.findOneBy({
      user_id: userId,
    });
    expect(token!.used_at).toBeInstanceOf(Date);
  });

  it('throws InvalidTokenException for an unknown token', async () => {
    await expect(authService.confirm('unknowntoken')).rejects.toThrow(
      InvalidTokenException,
    );
  });

  it('throws TokenExpiredException for an expired token', async () => {
    const capturePromise = captureConfirmationToken(authService);
    const { id: userId } = await authService.register({
      email: 'expired@example.com',
      password: 'password123',
    });
    const capturedToken = await capturePromise;

    const tokenHash = crypto
      .createHash('sha256')
      .update(capturedToken)
      .digest('hex');
    await verificationTokenRepository.update(
      { token_hash: tokenHash },
      { expires_at: new Date(Date.now() - 1000) },
    );

    await expect(authService.confirm(capturedToken)).rejects.toThrow(
      TokenExpiredException,
    );
  });
});

describe('AuthService — resendConfirmation (integration)', () => {
  let authService: AuthService;
  let dataSource: DataSource;
  let verificationTokenRepository: Repository<VerificationToken>;

  beforeAll(async () => {
    const module = await createAuthTestModule();
    authService = module.get(AuthService);
    dataSource = module.get(DataSource);
    verificationTokenRepository = dataSource.getRepository(VerificationToken);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await clearMailpitMessages();
  });

  it('invalidates old tokens and creates a new confirmation token', async () => {
    const { id: userId } = await authService.register({
      email: 'resend@example.com',
      password: 'password123',
    });

    const oldToken = await verificationTokenRepository.findOneBy({
      user_id: userId,
    });
    expect(oldToken!.used_at).toBeNull();

    await authService.resendConfirmation('resend@example.com');

    const tokens = await verificationTokenRepository.findBy({
      user_id: userId,
    });
    const old = tokens.find((t) => t.id === oldToken!.id)!;
    expect(old.used_at).toBeInstanceOf(Date);

    const newToken = tokens.find((t) => t.id !== oldToken!.id);
    expect(newToken).toBeDefined();
    expect(newToken!.used_at).toBeNull();
  });

  it('returns silently for a non-existent email', async () => {
    await expect(
      authService.resendConfirmation('nobody@example.com'),
    ).resolves.toBeUndefined();
  });
});

describe('AuthService — login (integration)', () => {
  let authService: AuthService;
  let jwtService: JwtService;
  let dataSource: DataSource;
  let refreshTokenRepository: Repository<RefreshToken>;

  beforeAll(async () => {
    const module = await createAuthTestModule();
    authService = module.get(AuthService);
    jwtService = module.get(JwtService);
    dataSource = module.get(DataSource);
    refreshTokenRepository = dataSource.getRepository(RefreshToken);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await clearMailpitMessages();
  });

  async function registerAndConfirmUser(
    email: string,
    password: string,
  ): Promise<string> {
    const capturePromise = captureConfirmationToken(authService);
    const { id } = await authService.register({ email, password });
    const capturedToken = await capturePromise;
    await authService.confirm(capturedToken);
    return id;
  }

  it('persists a refresh token in DB with correct family UUID and expiry', async () => {
    const userId = await registerAndConfirmUser(
      'logintest@example.com',
      'password123',
    );

    const { refresh_token } = await authService.login({
      email: 'logintest@example.com',
      password: 'password123',
    });

    const tokenHash = crypto
      .createHash('sha256')
      .update(refresh_token)
      .digest('hex');
    const record = await refreshTokenRepository.findOneBy({
      token_hash: tokenHash,
    });

    expect(record).not.toBeNull();
    expect(record!.user_id).toBe(userId);
    expect(record!.family).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(record!.expires_at).toBeInstanceOf(Date);
    expect(record!.expires_at.getTime()).toBeGreaterThan(Date.now());
    expect(record!.revoked_at).toBeNull();
  });

  it('returns a valid JWT access token with correct sub and email claims', async () => {
    await registerAndConfirmUser('jwttest@example.com', 'password123');

    const { access_token } = await authService.login({
      email: 'jwttest@example.com',
      password: 'password123',
    });

    const payload = jwtService.verify<{ sub: string; email: string }>(
      access_token,
    );
    expect(payload.sub).toBeDefined();
    expect(payload.email).toBe('jwttest@example.com');
  });
});

describe('AuthService — refresh (integration)', () => {
  let authService: AuthService;
  let jwtService: JwtService;
  let dataSource: DataSource;
  let refreshTokenRepository: Repository<RefreshToken>;

  beforeAll(async () => {
    const module = await createAuthTestModule();
    authService = module.get(AuthService);
    jwtService = module.get(JwtService);
    dataSource = module.get(DataSource);
    refreshTokenRepository = dataSource.getRepository(RefreshToken);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await clearMailpitMessages();
  });

  it('rotates token: revokes old token and persists new token in DB', async () => {
    const { refreshToken: token1 } = await registerConfirmAndLogin(
      authService,
      'rotate@example.com',
      'password123',
    );

    const { refresh_token: token2, access_token } =
      await authService.refresh(token1);

    expect(token2).not.toBe(token1);
    expect(access_token).toBeDefined();

    const hash1 = crypto.createHash('sha256').update(token1).digest('hex');
    const old = await refreshTokenRepository.findOneBy({ token_hash: hash1 });
    expect(old!.revoked_at).toBeInstanceOf(Date);

    const hash2 = crypto.createHash('sha256').update(token2).digest('hex');
    const fresh = await refreshTokenRepository.findOneBy({ token_hash: hash2 });
    expect(fresh).not.toBeNull();
    expect(fresh!.revoked_at).toBeNull();
    expect(fresh!.family).toBe(old!.family);
  });

  it('access token from refresh is a valid JWT with correct sub and email', async () => {
    const { refreshToken } = await registerConfirmAndLogin(
      authService,
      'jwtrefresh@example.com',
      'password123',
    );

    const { access_token } = await authService.refresh(refreshToken);

    const payload = jwtService.verify<{ sub: string; email: string }>(
      access_token,
    );
    expect(payload.sub).toBeDefined();
    expect(payload.email).toBe('jwtrefresh@example.com');
  });

  it('returns valid access token within grace period without revoking family', async () => {
    const { refreshToken: token1 } = await registerConfirmAndLogin(
      authService,
      'grace@example.com',
      'password123',
    );

    await authService.refresh(token1);

    const hash1 = crypto.createHash('sha256').update(token1).digest('hex');
    const revokedRecord = await refreshTokenRepository.findOneBy({
      token_hash: hash1,
    });
    const family = revokedRecord!.family;

    const { access_token } = await authService.refresh(token1);
    expect(access_token).toBeDefined();

    const activeTokens = await refreshTokenRepository.findBy({
      family,
      revoked_at: null,
    } as any);
    expect(activeTokens.length).toBeGreaterThan(0);
  });

  it('revokes entire family and throws when reuse is detected beyond grace period', async () => {
    const { refreshToken: token1 } = await registerConfirmAndLogin(
      authService,
      'reuse@example.com',
      'password123',
    );

    await authService.refresh(token1);

    const hash1 = crypto.createHash('sha256').update(token1).digest('hex');
    const revokedRecord = await refreshTokenRepository.findOneBy({
      token_hash: hash1,
    });
    const family = revokedRecord!.family;

    await refreshTokenRepository.update(
      { token_hash: hash1 },
      { revoked_at: new Date(Date.now() - 15_000) },
    );

    await expect(authService.refresh(token1)).rejects.toThrow(
      TokenReuseDetectedException,
    );

    const allTokens = await refreshTokenRepository.findBy({ family });
    const anyActive = allTokens.some((t) => t.revoked_at === null);
    expect(anyActive).toBe(false);
  });
});

describe('AuthService — logout (integration)', () => {
  let authService: AuthService;
  let dataSource: DataSource;
  let refreshTokenRepository: Repository<RefreshToken>;

  beforeAll(async () => {
    const module = await createAuthTestModule();
    authService = module.get(AuthService);
    dataSource = module.get(DataSource);
    refreshTokenRepository = dataSource.getRepository(RefreshToken);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await clearMailpitMessages();
  });

  it('revokes all active refresh tokens for the user after logout', async () => {
    const { userId, refreshToken: token1 } = await registerConfirmAndLogin(
      authService,
      'logout@example.com',
      'password123',
    );

    await authService.refresh(token1);
    await authService.logout(userId);

    const allTokens = await refreshTokenRepository.findBy({ user_id: userId });
    expect(allTokens.length).toBeGreaterThan(0);
    const anyActive = allTokens.some((t) => t.revoked_at === null);
    expect(anyActive).toBe(false);
  });

  it('does not revoke tokens from other users', async () => {
    const { userId: user1Id } = await registerConfirmAndLogin(
      authService,
      'logout1@example.com',
      'password123',
    );
    const { userId: user2Id } = await registerConfirmAndLogin(
      authService,
      'logout2@example.com',
      'password123',
    );

    await authService.logout(user1Id);

    const user2Tokens = await refreshTokenRepository.findBy({
      user_id: user2Id,
    });
    const anyUser2Active = user2Tokens.some((t) => t.revoked_at === null);
    expect(anyUser2Active).toBe(true);
  });
});

function capturePasswordResetToken(authService: AuthService): Promise<string> {
  return new Promise((resolve) => {
    const mailServiceInstance = (authService as any).mailService;
    jest
      .spyOn(mailServiceInstance, 'sendPasswordResetEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) =>
        resolve(t),
      );
  });
}

describe('AuthService — forgotPassword (integration)', () => {
  let authService: AuthService;
  let dataSource: DataSource;
  let verificationTokenRepository: Repository<VerificationToken>;

  beforeAll(async () => {
    const module = await createAuthTestModule();
    authService = module.get(AuthService);
    dataSource = module.get(DataSource);
    verificationTokenRepository = dataSource.getRepository(VerificationToken);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await clearMailpitMessages();
  });

  it('persists a password reset token and sends an email containing the raw token', async () => {
    const capturePromise = capturePasswordResetToken(authService);
    const { id: userId } = await authService.register({
      email: 'forgot@example.com',
      password: 'password123',
    });

    await authService.forgotPassword('forgot@example.com');
    const capturedRawToken = await capturePromise;

    const expectedHash = crypto
      .createHash('sha256')
      .update(capturedRawToken)
      .digest('hex');
    const tokens = await verificationTokenRepository.findBy({
      user_id: userId,
      type: VerificationTokenType.PASSWORD_RESET,
    });
    expect(tokens.length).toBe(1);
    expect(tokens[0].token_hash).toBe(expectedHash);
    expect(tokens[0].used_at).toBeNull();
  });

  it('invalidates previously issued unused reset tokens', async () => {
    const capturePromise1 = capturePasswordResetToken(authService);
    const { id: userId } = await authService.register({
      email: 'reissue@example.com',
      password: 'password123',
    });
    await authService.forgotPassword('reissue@example.com');
    const firstRawToken = await capturePromise1;
    const firstHash = crypto
      .createHash('sha256')
      .update(firstRawToken)
      .digest('hex');

    const capturePromise2 = capturePasswordResetToken(authService);
    await authService.forgotPassword('reissue@example.com');
    await capturePromise2;

    const oldRecord = await verificationTokenRepository.findOneBy({
      token_hash: firstHash,
    });
    expect(oldRecord!.used_at).toBeInstanceOf(Date);

    const allResetTokens = await verificationTokenRepository.findBy({
      user_id: userId,
      type: VerificationTokenType.PASSWORD_RESET,
    });
    const unusedCount = allResetTokens.filter((t) => t.used_at === null).length;
    expect(unusedCount).toBe(1);
  });

  it('returns silently for an unregistered email', async () => {
    await expect(
      authService.forgotPassword('nobody@example.com'),
    ).resolves.toBeUndefined();
  });
});

describe('AuthService — resetPassword (integration)', () => {
  let authService: AuthService;
  let dataSource: DataSource;
  let verificationTokenRepository: Repository<VerificationToken>;
  let userRepository: Repository<User>;
  let refreshTokenRepository: Repository<RefreshToken>;

  beforeAll(async () => {
    const module = await createAuthTestModule();
    authService = module.get(AuthService);
    dataSource = module.get(DataSource);
    verificationTokenRepository = dataSource.getRepository(VerificationToken);
    userRepository = dataSource.getRepository(User);
    refreshTokenRepository = dataSource.getRepository(RefreshToken);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await clearMailpitMessages();
  });

  async function registerConfirmAndRequestReset(
    email: string,
    password: string,
  ): Promise<{ userId: string; resetToken: string }> {
    const { userId } = await registerConfirmAndLogin(
      authService,
      email,
      password,
    );
    const capturePromise = capturePasswordResetToken(authService);
    await authService.forgotPassword(email);
    const resetToken = await capturePromise;
    return { userId, resetToken };
  }

  it('updates the password hash, marks token used, and revokes all refresh tokens', async () => {
    const { userId, resetToken } = await registerConfirmAndRequestReset(
      'reset@example.com',
      'oldpassword',
    );

    await authService.resetPassword(resetToken, 'newpassword');

    const user = await userRepository
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.id = :id', { id: userId })
      .getOne();
    expect(user!.password).not.toBe('oldpassword');
    expect(await argon2.verify(user!.password, 'newpassword')).toBe(true);

    const tokenHash = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    const tokenRecord = await verificationTokenRepository.findOneBy({
      token_hash: tokenHash,
    });
    expect(tokenRecord!.used_at).toBeInstanceOf(Date);

    const userRefreshTokens = await refreshTokenRepository.findBy({
      user_id: userId,
    });
    expect(userRefreshTokens.length).toBeGreaterThan(0);
    const anyActive = userRefreshTokens.some((t) => t.revoked_at === null);
    expect(anyActive).toBe(false);
  });

  it('throws InvalidTokenException for an unknown token', async () => {
    await expect(
      authService.resetPassword('unknown', 'newpassword'),
    ).rejects.toThrow(InvalidTokenException);
  });

  it('throws TokenExpiredException for an expired reset token', async () => {
    const { resetToken } = await registerConfirmAndRequestReset(
      'expired@example.com',
      'oldpassword',
    );
    const tokenHash = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    await verificationTokenRepository.update(
      { token_hash: tokenHash },
      { expires_at: new Date(Date.now() - 1000) },
    );

    await expect(
      authService.resetPassword(resetToken, 'newpassword'),
    ).rejects.toThrow(TokenExpiredException);
  });

  it('throws InvalidTokenException when the same token is reused', async () => {
    const { resetToken } = await registerConfirmAndRequestReset(
      'reuse-reset@example.com',
      'oldpassword',
    );

    await authService.resetPassword(resetToken, 'newpassword');

    await expect(
      authService.resetPassword(resetToken, 'anotherpassword'),
    ).rejects.toThrow(InvalidTokenException);
  });

  it('allows login with the new password and rejects the old one', async () => {
    const { resetToken } = await registerConfirmAndRequestReset(
      'newlogin@example.com',
      'oldpassword',
    );

    await authService.resetPassword(resetToken, 'newpassword');

    await expect(
      authService.login({
        email: 'newlogin@example.com',
        password: 'oldpassword',
      }),
    ).rejects.toThrow(InvalidCredentialsException);

    const result = await authService.login({
      email: 'newlogin@example.com',
      password: 'newpassword',
    });
    expect(result.access_token).toBeDefined();
  });
});
