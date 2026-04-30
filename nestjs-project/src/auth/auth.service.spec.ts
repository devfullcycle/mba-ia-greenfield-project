import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Repository } from 'typeorm';
import authConfig from '../config/auth.config';
import { EmailAlreadyExistsException } from '../common/exceptions/domain.exception';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { VerificationToken, VerificationTokenType } from './entities/verification-token.entity';

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
          provide: authConfig.KEY,
          useValue: mockAuthConfig,
        },
      ],
    }).compile();

    authService = module.get(AuthService);
    usersService = module.get(UsersService);
    mailService = module.get(MailService);
    verificationTokenRepository = module.get(getRepositoryToken(VerificationToken));
  });

  it('throws EmailAlreadyExistsException when email is already registered', async () => {
    usersService.findByEmail.mockResolvedValue({ id: 'u1', email: 'test@example.com' } as any);

    await expect(
      authService.register({ email: 'test@example.com', password: 'password123' }),
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

    await authService.register({ email: 'new@example.com', password: 'plaintext' });

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

    await authService.register({ email: 'new@example.com', password: 'password123' });

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
    const createdToken = { type: VerificationTokenType.EMAIL_CONFIRMATION } as VerificationToken;
    verificationTokenRepository.create.mockReturnValue(createdToken);

    await authService.register({ email: 'new@example.com', password: 'password123' });

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

    await authService.register({ email: 'new@example.com', password: 'password123' });

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

    const result = await authService.register({ email: 'new@example.com', password: 'password123' });

    expect(result).toEqual({ id: 'u1', email: 'new@example.com' });
  });
});
