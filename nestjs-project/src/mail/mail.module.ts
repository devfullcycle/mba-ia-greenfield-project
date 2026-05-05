import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { join } from 'path';
import mailConfig from '../config/mail.config';
import { MailService } from './mail.service';

@Module({
  imports: [
    MailerModule.forRootAsync({
      inject: [mailConfig.KEY],
      useFactory: (mail: ConfigType<typeof mailConfig>) => ({
        transport: {
          host: mail.host,
          port: mail.port,
        },
        defaults: {
          from: mail.from,
        },
        template: {
          dir: join(__dirname, 'templates'),
          adapter: new HandlebarsAdapter(),
          options: { strict: true },
        },
      }),
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
