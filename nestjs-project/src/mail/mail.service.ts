import { MailerService } from '@nestjs-modules/mailer';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import appConfig from '../config/app.config';
import { MAIL_SUBJECTS, MAIL_TEMPLATES } from './mail.constants';

@Injectable()
export class MailService {
  private readonly appUrl: string;

  constructor(
    private readonly mailerService: MailerService,
    @Inject(appConfig.KEY) app: ConfigType<typeof appConfig>,
  ) {
    this.appUrl = app.url;
  }

  async sendConfirmationEmail(email: string, name: string, token: string): Promise<void> {
    const confirmationUrl = `${this.appUrl}/auth/confirm-email?token=${token}`;
    await this.mailerService.sendMail({
      to: email,
      subject: MAIL_SUBJECTS.CONFIRMATION,
      template: MAIL_TEMPLATES.CONFIRMATION,
      context: { name, confirmationUrl },
    });
  }

  async sendPasswordResetEmail(email: string, name: string, token: string): Promise<void> {
    const resetUrl = `${this.appUrl}/auth/reset-password?token=${token}`;
    await this.mailerService.sendMail({
      to: email,
      subject: MAIL_SUBJECTS.PASSWORD_RESET,
      template: MAIL_TEMPLATES.PASSWORD_RESET,
      context: { name, resetUrl },
    });
  }
}
