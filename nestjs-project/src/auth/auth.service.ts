import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import authConfig from '../config/auth.config';
import { EmailAlreadyExistsException } from '../common/exceptions/domain.exception';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { VerificationToken, VerificationTokenType } from './entities/verification-token.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    @InjectRepository(VerificationToken)
    private readonly verificationTokenRepository: Repository<VerificationToken>,
    @Inject(authConfig.KEY) private readonly authCfg: ConfigType<typeof authConfig>,
  ) {}

  async register(dto: RegisterDto): Promise<{ id: string; email: string }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new EmailAlreadyExistsException();
    }

    const hashedPassword = await argon2.hash(dto.password);
    const user = await this.usersService.createUserWithChannel(dto.email, hashedPassword);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = new Date(
      Date.now() + this.authCfg.confirmationTokenExpirationHours * 60 * 60 * 1000,
    );

    const verificationToken = this.verificationTokenRepository.create({
      token_hash: tokenHash,
      type: VerificationTokenType.EMAIL_CONFIRMATION,
      user_id: user.id,
      expires_at: expiresAt,
    });
    await this.verificationTokenRepository.save(verificationToken);

    await this.mailService.sendConfirmationEmail(user.email, user.channel.name, rawToken);

    return { id: user.id, email: user.email };
  }
}
