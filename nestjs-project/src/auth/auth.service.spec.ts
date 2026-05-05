import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Repository } from 'typeorm';
import authConfig from '../config/auth.config';
import {
  EmailAlreadyExistsException,
  EmailNotConfirmedException,
  InvalidCredentialsException,
  InvalidTokenException,
  TokenExpiredException,
  TokenReuseDetectedException,
} from '../common/exceptions/domain.exception';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import {
  VerificationToken,
  VerificationTokenType,
} from './entities/verification-token.entity';

const mockAuthConfig = {
  jwtSecret: 'test-secret',
  jwtRefreshSecret: 'test-refresh-secret',
  jwtAccessExpiration: '15m',
  jwtRefreshExpiration: '7d',
  confirmationTokenExpirationHours: 1,
  passwordResetTokenExpirationHours: 1,
};

describe('AuthService — register', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let mailService: jest.Mocked<MailService>;
  let verificationTokenRepository: jest.Mocked<Repository<VerificationToken>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret',
          signOptions: { expiresIn: '15m' },
        }),
      ],
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            createUserWithChannel: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getRepositoryToken(VerificationToken),
          useValue: {
            create: jest.fn(),
            save: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: {
            create: jest.fn().mockReturnValue({}),
            save: jest.fn().mockResolvedValue({}),
            findOne: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: authConfig.KEY,
          useValue: mockAuthConfig,
        },
      ],
    }).compile();

    authService = module.get(AuthService);
    usersService = module.get(UsersService);
    mailService = module.get(MailService);
    verificationTokenRepository = module.get(
      getRepositoryToken(VerificationToken),
    );
  });

  it('throws EmailAlreadyExistsException when email is already registered', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'u1',
      email: 'test@example.com',
    } as any);

    await expect(
      authService.register({
        email: 'test@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow(EmailAlreadyExistsException);
  });

  it('hashes the password before creating the user', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.createUserWithChannel.mockResolvedValue({
      id: 'u1',
      email: 'new@example.com',
      channel: { name: 'new' },
    } as any);
    verificationTokenRepository.create.mockReturnValue({} as any);

    await authService.register({
      email: 'new@example.com',
      password: 'plaintext',
    });

    const [, hashedPassword] = usersService.createUserWithChannel.mock.calls[0];
    expect(hashedPassword).not.toBe('plaintext');
    expect(hashedPassword).toMatch(/^\$argon2/);
  });

  it('calls createUserWithChannel with the correct email', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.createUserWithChannel.mockResolvedValue({
      id: 'u1',
      email: 'new@example.com',
      channel: { name: 'new' },
    } as any);
    verificationTokenRepository.create.mockReturnValue({} as any);

    await authService.register({
      email: 'new@example.com',
      password: 'password123',
    });

    expect(usersService.createUserWithChannel).toHaveBeenCalledWith(
      'new@example.com',
      expect.any(String),
    );
  });

  it('stores a verification token with EMAIL_CONFIRMATION type', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.createUserWithChannel.mockResolvedValue({
      id: 'u1',
      email: 'new@example.com',
      channel: { name: 'new' },
    } as any);
    const createdToken = {
      type: VerificationTokenType.EMAIL_CONFIRMATION,
    } as VerificationToken;
    verificationTokenRepository.create.mockReturnValue(createdToken);

    await authService.register({
      email: 'new@example.com',
      password: 'password123',
    });

    expect(verificationTokenRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: VerificationTokenType.EMAIL_CONFIRMATION,
        user_id: 'u1',
      }),
    );
    expect(verificationTokenRepository.save).toHaveBeenCalledWith(createdToken);
  });

  it('sends a confirmation email with the raw token', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.createUserWithChannel.mockResolvedValue({
      id: 'u1',
      email: 'new@example.com',
      channel: { name: 'mynick' },
    } as any);
    verificationTokenRepository.create.mockReturnValue({} as any);

    await authService.register({
      email: 'new@example.com',
      password: 'password123',
    });

    expect(mailService.sendConfirmationEmail).toHaveBeenCalledWith(
      'new@example.com',
      'mynick',
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });

  it('returns the user id and email', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.createUserWithChannel.mockResolvedValue({
      id: 'u1',
      email: 'new@example.com',
      channel: { name: 'new' },
    } as any);
    verificationTokenRepository.create.mockReturnValue({} as any);

    const result = await authService.register({
      email: 'new@example.com',
      password: 'password123',
    });

    expect(result).toEqual({ id: 'u1', email: 'new@example.com' });
  });
});

function buildTestModule() {
  return Test.createTestingModule({
    imports: [
      JwtModule.register({
        secret: 'test-secret',
        signOptions: { expiresIn: '15m' },
      }),
    ],
    providers: [
      AuthService,
      {
        provide: UsersService,
        useValue: {
          findByEmail: jest.fn(),
          findByEmailWithChannel: jest.fn(),
          createUserWithChannel: jest.fn(),
          save: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: MailService,
        useValue: {
          sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
          sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: getRepositoryToken(VerificationToken),
        useValue: {
          create: jest.fn(),
          save: jest.fn().mockResolvedValue({}),
          findOne: jest.fn(),
          createQueryBuilder: jest.fn(),
        },
      },
      {
        provide: getRepositoryToken(RefreshToken),
        useValue: {
          create: jest.fn().mockReturnValue({}),
          save: jest.fn().mockResolvedValue({}),
          findOne: jest.fn(),
          createQueryBuilder: jest.fn(),
        },
      },
      {
        provide: authConfig.KEY,
        useValue: mockAuthConfig,
      },
    ],
  }).compile();
}

describe('AuthService — confirm', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let verificationTokenRepository: jest.Mocked<Repository<VerificationToken>>;

  beforeEach(async () => {
    const module = await buildTestModule();
    authService = module.get(AuthService);
    usersService = module.get(UsersService);
    verificationTokenRepository = module.get(
      getRepositoryToken(VerificationToken),
    );
  });

  it('marks user as confirmed and token as used for a valid token', async () => {
    const rawToken = 'a'.repeat(64);
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    const user = { id: 'u1', is_confirmed: false } as any;
    const record = {
      token_hash: tokenHash,
      type: VerificationTokenType.EMAIL_CONFIRMATION,
      used_at: null,
      expires_at: new Date(Date.now() + 60_000),
      user,
    } as any;

    verificationTokenRepository.findOne.mockResolvedValue(record);

    await authService.confirm(rawToken);

    expect(record.used_at).toBeInstanceOf(Date);
    expect(user.is_confirmed).toBe(true);
    expect(verificationTokenRepository.save).toHaveBeenCalledWith(record);
    expect(usersService.save).toHaveBeenCalledWith(user);
  });

  it('throws InvalidTokenException when token is not found', async () => {
    verificationTokenRepository.findOne.mockResolvedValue(null);

    await expect(authService.confirm('nonexistent-token')).rejects.toThrow(
      InvalidTokenException,
    );
  });

  it('throws TokenExpiredException when token is expired', async () => {
    const rawToken = 'b'.repeat(64);
    const record = {
      token_hash: crypto.createHash('sha256').update(rawToken).digest('hex'),
      type: VerificationTokenType.EMAIL_CONFIRMATION,
      used_at: null,
      expires_at: new Date(Date.now() - 1000),
      user: { id: 'u1', is_confirmed: false },
    } as any;

    verificationTokenRepository.findOne.mockResolvedValue(record);

    await expect(authService.confirm(rawToken)).rejects.toThrow(
      TokenExpiredException,
    );
  });
});

describe('AuthService — resendConfirmation', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let mailService: jest.Mocked<MailService>;
  let verificationTokenRepository: jest.Mocked<Repository<VerificationToken>>;

  beforeEach(async () => {
    const module = await buildTestModule();
    authService = module.get(AuthService);
    usersService = module.get(UsersService);
    mailService = module.get(MailService);
    verificationTokenRepository = module.get(
      getRepositoryToken(VerificationToken),
    );
  });

  it('returns silently when email is not found', async () => {
    usersService.findByEmailWithChannel.mockResolvedValue(null);

    await expect(
      authService.resendConfirmation('unknown@example.com'),
    ).resolves.toBeUndefined();
    expect(mailService.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('returns silently when user is already confirmed', async () => {
    usersService.findByEmailWithChannel.mockResolvedValue({
      id: 'u1',
      is_confirmed: true,
      channel: { name: 'nick' },
    } as any);

    await expect(
      authService.resendConfirmation('confirmed@example.com'),
    ).resolves.toBeUndefined();
    expect(mailService.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('invalidates old tokens and sends a new confirmation email', async () => {
    const user = {
      id: 'u1',
      email: 'user@example.com',
      is_confirmed: false,
      channel: { name: 'nick' },
    } as any;
    usersService.findByEmailWithChannel.mockResolvedValue(user);

    const qbMock = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    verificationTokenRepository.createQueryBuilder.mockReturnValue(
      qbMock as any,
    );
    verificationTokenRepository.create.mockReturnValue({} as any);

    await authService.resendConfirmation('user@example.com');

    expect(qbMock.execute).toHaveBeenCalled();
    expect(verificationTokenRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: VerificationTokenType.EMAIL_CONFIRMATION,
        user_id: 'u1',
      }),
    );
    expect(mailService.sendConfirmationEmail).toHaveBeenCalledWith(
      'user@example.com',
      'nick',
      expect.any(String),
    );
  });
});

describe('AuthService — login', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let refreshTokenRepository: jest.Mocked<Repository<RefreshToken>>;
  let hashedTestPassword: string;

  beforeAll(async () => {
    hashedTestPassword = await argon2.hash('correctpassword');
  });

  beforeEach(async () => {
    const module = await buildTestModule();
    authService = module.get(AuthService);
    usersService = module.get(UsersService);
    refreshTokenRepository = module.get(getRepositoryToken(RefreshToken));
  });

  it('throws InvalidCredentialsException when email is not found', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(
      authService.login({
        email: 'nobody@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow(InvalidCredentialsException);
  });

  it('throws InvalidCredentialsException when password is wrong', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      password: hashedTestPassword,
      is_confirmed: true,
    } as any);

    await expect(
      authService.login({
        email: 'user@example.com',
        password: 'wrongpassword',
      }),
    ).rejects.toThrow(InvalidCredentialsException);
  });

  it('throws EmailNotConfirmedException when user is not confirmed', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      password: hashedTestPassword,
      is_confirmed: false,
    } as any);

    await expect(
      authService.login({
        email: 'user@example.com',
        password: 'correctpassword',
      }),
    ).rejects.toThrow(EmailNotConfirmedException);
  });

  it('returns access_token and refresh_token on valid credentials', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      password: hashedTestPassword,
      is_confirmed: true,
    } as any);

    const result = await authService.login({
      email: 'user@example.com',
      password: 'correctpassword',
    });

    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBeDefined();
    expect(typeof result.access_token).toBe('string');
    expect(typeof result.refresh_token).toBe('string');
    expect(refreshTokenRepository.save).toHaveBeenCalled();
  });
});

describe('AuthService — refresh', () => {
  let authService: AuthService;
  let refreshTokenRepository: jest.Mocked<Repository<RefreshToken>>;

  const mockUser = { id: 'u1', email: 'user@example.com' } as any;
  const rawToken = 'a'.repeat(64);
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  beforeEach(async () => {
    const module = await buildTestModule();
    authService = module.get(AuthService);
    refreshTokenRepository = module.get(getRepositoryToken(RefreshToken));
  });

  it('throws InvalidTokenException when token is not found', async () => {
    refreshTokenRepository.findOne.mockResolvedValue(null);

    await expect(authService.refresh(rawToken)).rejects.toThrow(
      InvalidTokenException,
    );
  });

  it('throws TokenExpiredException when token is expired', async () => {
    const record = {
      token_hash: tokenHash,
      family: 'family-uuid',
      user_id: 'u1',
      user: mockUser,
      expires_at: new Date(Date.now() - 1000),
      revoked_at: null,
    } as any;
    refreshTokenRepository.findOne.mockResolvedValue(record);

    await expect(authService.refresh(rawToken)).rejects.toThrow(
      TokenExpiredException,
    );
  });

  it('rotates token: revokes old, persists new, returns both tokens', async () => {
    const record = {
      token_hash: tokenHash,
      family: 'family-uuid',
      user_id: 'u1',
      user: mockUser,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
    } as any;
    refreshTokenRepository.findOne.mockResolvedValue(record);
    refreshTokenRepository.create.mockReturnValue({} as any);

    const result = await authService.refresh(rawToken);

    expect(record.revoked_at).toBeInstanceOf(Date);
    expect(refreshTokenRepository.save).toHaveBeenCalledWith(record);
    expect(refreshTokenRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ family: 'family-uuid', user_id: 'u1' }),
    );
    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBeDefined();
    expect(result.refresh_token).not.toBe(rawToken);
  });

  it('returns new access token without revoking family when reuse is within grace period', async () => {
    const revokedAt = new Date(Date.now() - 5_000);
    const record = {
      token_hash: tokenHash,
      family: 'family-uuid',
      user_id: 'u1',
      user: mockUser,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: revokedAt,
    } as any;
    refreshTokenRepository.findOne.mockResolvedValue(record);

    const result = await authService.refresh(rawToken);

    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBe(rawToken);
    expect(refreshTokenRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('revokes entire family and throws TokenReuseDetectedException beyond grace period', async () => {
    const revokedAt = new Date(Date.now() - 15_000);
    const record = {
      token_hash: tokenHash,
      family: 'family-uuid',
      user_id: 'u1',
      user: mockUser,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: revokedAt,
    } as any;
    refreshTokenRepository.findOne.mockResolvedValue(record);

    const qbMock = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    refreshTokenRepository.createQueryBuilder.mockReturnValue(qbMock as any);

    await expect(authService.refresh(rawToken)).rejects.toThrow(
      TokenReuseDetectedException,
    );

    expect(qbMock.execute).toHaveBeenCalled();
    expect(qbMock.where).toHaveBeenCalledWith('family = :family', {
      family: 'family-uuid',
    });
  });
});

describe('AuthService — logout', () => {
  let authService: AuthService;
  let refreshTokenRepository: jest.Mocked<Repository<RefreshToken>>;

  beforeEach(async () => {
    const module = await buildTestModule();
    authService = module.get(AuthService);
    refreshTokenRepository = module.get(getRepositoryToken(RefreshToken));
  });

  it('revokes all active refresh tokens for the user', async () => {
    const qbMock = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    refreshTokenRepository.createQueryBuilder.mockReturnValue(qbMock as any);

    await authService.logout('user-id-123');

    expect(qbMock.set).toHaveBeenCalledWith({ revoked_at: expect.any(Date) });
    expect(qbMock.where).toHaveBeenCalledWith('user_id = :userId', {
      userId: 'user-id-123',
    });
    expect(qbMock.andWhere).toHaveBeenCalledWith('revoked_at IS NULL');
    expect(qbMock.execute).toHaveBeenCalled();
  });
});

describe('AuthService — forgotPassword', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let mailService: jest.Mocked<MailService>;
  let verificationTokenRepository: jest.Mocked<Repository<VerificationToken>>;

  beforeEach(async () => {
    const module = await buildTestModule();
    authService = module.get(AuthService);
    usersService = module.get(UsersService);
    mailService = module.get(MailService);
    verificationTokenRepository = module.get(
      getRepositoryToken(VerificationToken),
    );
  });

  it('returns silently when email is not registered', async () => {
    usersService.findByEmailWithChannel.mockResolvedValue(null);

    await expect(
      authService.forgotPassword('unknown@example.com'),
    ).resolves.toBeUndefined();
    expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('invalidates previous reset tokens and sends a reset email', async () => {
    const user = {
      id: 'u1',
      email: 'user@example.com',
      channel: { name: 'nick' },
    } as any;
    usersService.findByEmailWithChannel.mockResolvedValue(user);

    const qbMock = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    verificationTokenRepository.createQueryBuilder.mockReturnValue(
      qbMock as any,
    );
    verificationTokenRepository.create.mockReturnValue({} as any);

    await authService.forgotPassword('user@example.com');

    expect(qbMock.execute).toHaveBeenCalled();
    expect(qbMock.andWhere).toHaveBeenCalledWith('type = :type', {
      type: VerificationTokenType.PASSWORD_RESET,
    });
    expect(verificationTokenRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: VerificationTokenType.PASSWORD_RESET,
        user_id: 'u1',
      }),
    );
    expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      'user@example.com',
      'nick',
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });
});

describe('AuthService — resetPassword', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let verificationTokenRepository: jest.Mocked<Repository<VerificationToken>>;
  let refreshTokenRepository: jest.Mocked<Repository<RefreshToken>>;

  beforeEach(async () => {
    const module = await buildTestModule();
    authService = module.get(AuthService);
    usersService = module.get(UsersService);
    verificationTokenRepository = module.get(
      getRepositoryToken(VerificationToken),
    );
    refreshTokenRepository = module.get(getRepositoryToken(RefreshToken));
  });

  it('throws InvalidTokenException when token is not found', async () => {
    verificationTokenRepository.findOne.mockResolvedValue(null);

    await expect(
      authService.resetPassword('badtoken', 'newpassword'),
    ).rejects.toThrow(InvalidTokenException);
  });

  it('throws TokenExpiredException when token is expired', async () => {
    const rawToken = 'c'.repeat(64);
    const record = {
      token_hash: crypto.createHash('sha256').update(rawToken).digest('hex'),
      type: VerificationTokenType.PASSWORD_RESET,
      used_at: null,
      expires_at: new Date(Date.now() - 1000),
      user: { id: 'u1', password: 'oldhash' },
    } as any;
    verificationTokenRepository.findOne.mockResolvedValue(record);

    await expect(
      authService.resetPassword(rawToken, 'newpassword'),
    ).rejects.toThrow(TokenExpiredException);
  });

  it('hashes the new password, marks token used, and revokes refresh tokens', async () => {
    const rawToken = 'd'.repeat(64);
    const user = { id: 'u1', password: 'oldhash' } as any;
    const record = {
      token_hash: crypto.createHash('sha256').update(rawToken).digest('hex'),
      type: VerificationTokenType.PASSWORD_RESET,
      used_at: null,
      expires_at: new Date(Date.now() + 60_000),
      user,
    } as any;
    verificationTokenRepository.findOne.mockResolvedValue(record);

    const qbMock = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    refreshTokenRepository.createQueryBuilder.mockReturnValue(qbMock as any);

    await authService.resetPassword(rawToken, 'newplaintext');

    expect(record.used_at).toBeInstanceOf(Date);
    expect(user.password).not.toBe('oldhash');
    expect(user.password).toMatch(/^\$argon2/);
    expect(verificationTokenRepository.save).toHaveBeenCalledWith(record);
    expect(usersService.save).toHaveBeenCalledWith(user);
    expect(qbMock.where).toHaveBeenCalledWith('user_id = :userId', {
      userId: 'u1',
    });
    expect(qbMock.execute).toHaveBeenCalled();
  });
});
