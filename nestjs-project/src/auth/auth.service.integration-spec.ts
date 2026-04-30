import * as crypto from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import appConfig from '../config/app.config';
import authConfig from '../config/auth.config';
import mailConfig from '../config/mail.config';
import { EmailAlreadyExistsException } from '../common/exceptions/domain.exception';
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

describe('AuthService — register (integration)', () => {
  let authService: AuthService;
  let dataSource: DataSource;
  let verificationTokenRepository: Repository<VerificationToken>;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    const ds = createTestDataSource(ALL_ENTITIES);

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig, authConfig, mailConfig] }),
        TypeOrmModule.forRoot(ds.options),
        TypeOrmModule.forFeature([User, Channel, VerificationToken, RefreshToken]),
        UsersModule,
        MailModule,
      ],
      providers: [AuthService],
    }).compile();

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
    // We intercept sendConfirmationEmail to capture the raw token
    const mailService = (authService as any).mailService;
    let capturedRawToken: string | undefined;
    jest
      .spyOn(mailService, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_email: string, _name: string, token: string) => {
        capturedRawToken = token;
      });

    const result = await authService.register({
      email: 'verify@example.com',
      password: 'password123',
    });

    expect(capturedRawToken).toBeDefined();
    const expectedHash = crypto.createHash('sha256').update(capturedRawToken!).digest('hex');

    const token = await verificationTokenRepository.findOneBy({ user_id: result.id });
    expect(token!.token_hash).toBe(expectedHash);
  });
});
