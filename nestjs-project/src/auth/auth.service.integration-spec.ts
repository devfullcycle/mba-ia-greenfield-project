import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import appConfig from '../config/app.config';
import authConfig from '../config/auth.config';
import mailConfig from '../config/mail.config';
import {
  EmailAlreadyExistsException,
  InvalidTokenException,
  TokenExpiredException,
} from '../common/exceptions/domain.exception';
import { MailModule } from '../mail/mail.module';
import { Channel } from '../users/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { cleanAllTables, createTestDataSource } from '../test/create-test-data-source';
import { clearMailpitMessages } from '../test/mailpit';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { VerificationToken, VerificationTokenType } from './entities/verification-token.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken];

async function createAuthTestModule(): Promise<TestingModule> {
  const ds = createTestDataSource(ALL_ENTITIES);
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [appConfig, authConfig, mailConfig] }),
      TypeOrmModule.forRoot(ds.options),
      TypeOrmModule.forFeature([User, Channel, VerificationToken, RefreshToken]),
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
      .mockImplementationOnce(async (_e: string, _n: string, t: string) => resolve(t));
  });
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

    const token = await verificationTokenRepository.findOneBy({ user_id: result.id });
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

    const token = await verificationTokenRepository.findOneBy({ user_id: result.id });
    expect(token).not.toBeNull();
    expect(token!.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('throws EmailAlreadyExistsException on duplicate email', async () => {
    await authService.register({ email: 'dup@example.com', password: 'password123' });

    await expect(
      authService.register({ email: 'dup@example.com', password: 'password456' }),
    ).rejects.toThrow(EmailAlreadyExistsException);
  });

  it('confirmation token hash matches sha256 of raw token delivered by mail service', async () => {
    const capturePromise = captureConfirmationToken(authService);
    const result = await authService.register({
      email: 'verify@example.com',
      password: 'password123',
    });
    const capturedRawToken = await capturePromise;

    const expectedHash = crypto.createHash('sha256').update(capturedRawToken).digest('hex');

    const token = await verificationTokenRepository.findOneBy({ user_id: result.id });
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

    const token = await verificationTokenRepository.findOneBy({ user_id: userId });
    expect(token!.used_at).toBeInstanceOf(Date);
  });

  it('throws InvalidTokenException for an unknown token', async () => {
    await expect(authService.confirm('unknowntoken')).rejects.toThrow(InvalidTokenException);
  });

  it('throws TokenExpiredException for an expired token', async () => {
    const capturePromise = captureConfirmationToken(authService);
    const { id: userId } = await authService.register({
      email: 'expired@example.com',
      password: 'password123',
    });
    const capturedToken = await capturePromise;

    const tokenHash = crypto.createHash('sha256').update(capturedToken).digest('hex');
    await verificationTokenRepository.update({ token_hash: tokenHash }, { expires_at: new Date(Date.now() - 1000) });

    await expect(authService.confirm(capturedToken)).rejects.toThrow(TokenExpiredException);
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

    const oldToken = await verificationTokenRepository.findOneBy({ user_id: userId });
    expect(oldToken!.used_at).toBeNull();

    await authService.resendConfirmation('resend@example.com');

    const tokens = await verificationTokenRepository.findBy({ user_id: userId });
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
