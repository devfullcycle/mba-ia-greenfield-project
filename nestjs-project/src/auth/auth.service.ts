import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import authConfig from '../config/auth.config';
import {
  EmailAlreadyExistsException,
  EmailNotConfirmedException,
  InvalidCredentialsException,
  InvalidTokenException,
  TokenExpiredException,
} from '../common/exceptions/domain.exception';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshToken } from './entities/refresh-token.entity';
import { VerificationToken, VerificationTokenType } from './entities/verification-token.entity';

function jwtExpirationToMs(exp: string): number {
  const match = exp.match(/^(\d+)([smhd])$/);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (units[match[2]] ?? 0);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
    @InjectRepository(VerificationToken)
    private readonly verificationTokenRepository: Repository<VerificationToken>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @Inject(authConfig.KEY) private readonly authCfg: ConfigType<typeof authConfig>,
  ) {}

  async register(dto: RegisterDto): Promise<{ id: string; email: string }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new EmailAlreadyExistsException();
    }

    const hashedPassword = await argon2.hash(dto.password);
    const user = await this.usersService.createUserWithChannel(dto.email, hashedPassword);

    const rawToken = await this.createVerificationToken(
      user.id,
      VerificationTokenType.EMAIL_CONFIRMATION,
      this.authCfg.confirmationTokenExpirationHours,
    );
    await this.mailService.sendConfirmationEmail(user.email, user.channel.name, rawToken);

    return { id: user.id, email: user.email };
  }

  async login(dto: LoginDto): Promise<{ access_token: string; refresh_token: string }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new InvalidCredentialsException();
    }

    const isPasswordValid = await argon2.verify(user.password, dto.password);
    if (!isPasswordValid) {
      throw new InvalidCredentialsException();
    }

    if (!user.is_confirmed) {
      throw new EmailNotConfirmedException();
    }

    const accessToken = this.jwtService.sign(
      { sub: user.id, email: user.email },
      { expiresIn: this.authCfg.jwtAccessExpiration },
    );

    const family = crypto.randomUUID();
    const refreshToken = this.jwtService.sign(
      { sub: user.id, family },
      { secret: this.authCfg.jwtRefreshSecret, expiresIn: this.authCfg.jwtRefreshExpiration },
    );

    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + jwtExpirationToMs(this.authCfg.jwtRefreshExpiration));

    const refreshTokenRecord = this.refreshTokenRepository.create({
      token_hash: tokenHash,
      family,
      user_id: user.id,
      expires_at: expiresAt,
      revoked_at: null,
    });
    await this.refreshTokenRepository.save(refreshTokenRecord);

    return { access_token: accessToken, refresh_token: refreshToken };
  }

  async confirm(token: string): Promise<void> {
    const tokenHash = this.hashToken(token);

    const record = await this.verificationTokenRepository.findOne({
      where: {
        token_hash: tokenHash,
        type: VerificationTokenType.EMAIL_CONFIRMATION,
        used_at: IsNull(),
      },
      relations: ['user'],
    });

    if (!record) {
      throw new InvalidTokenException();
    }

    if (record.expires_at < new Date()) {
      throw new TokenExpiredException();
    }

    record.used_at = new Date();
    record.user.is_confirmed = true;

    await Promise.all([
      this.verificationTokenRepository.save(record),
      this.usersService.save(record.user),
    ]);
  }

  async resendConfirmation(email: string): Promise<void> {
    const user = await this.usersService.findByEmailWithChannel(email);
    if (!user || user.is_confirmed) {
      return;
    }

    await this.verificationTokenRepository
      .createQueryBuilder()
      .update(VerificationToken)
      .set({ used_at: new Date() })
      .where('user_id = :userId', { userId: user.id })
      .andWhere('type = :type', { type: VerificationTokenType.EMAIL_CONFIRMATION })
      .andWhere('used_at IS NULL')
      .execute();

    const rawToken = await this.createVerificationToken(
      user.id,
      VerificationTokenType.EMAIL_CONFIRMATION,
      this.authCfg.confirmationTokenExpirationHours,
    );
    await this.mailService.sendConfirmationEmail(user.email, user.channel.name, rawToken);
  }

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private async createVerificationToken(
    userId: string,
    type: VerificationTokenType,
    expirationHours: number,
  ): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + expirationHours * 60 * 60 * 1000);

    const verificationToken = this.verificationTokenRepository.create({
      token_hash: tokenHash,
      type,
      user_id: userId,
      expires_at: expiresAt,
    });
    await this.verificationTokenRepository.save(verificationToken);
    return rawToken;
  }
}
