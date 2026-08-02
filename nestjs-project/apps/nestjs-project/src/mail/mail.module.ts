import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { existsSync } from 'fs';
import { join } from 'path';
import mailConfig from '../config/mail.config';
import { MailService } from './mail.service';

// `__dirname` differs between ts-jest/ts-node (per-file, e.g. `src/mail`,
// so the templates directory is a direct child) and the webpack bundle
// used by `start:dev`/`start:prod` in Nest CLI monorepo mode (bundle root,
// e.g. `dist/apps/nestjs-project`, so the templates directory — copied by
// Nest CLI preserving its sourceRoot-relative path — sits one level deeper
// under `mail/`). Try the direct-child layout first, then the nested one.
const directChildTemplatesDir = join(__dirname, 'templates');
const nestedUnderMailTemplatesDir = join(__dirname, 'mail', 'templates');
const templatesDir = existsSync(directChildTemplatesDir)
  ? directChildTemplatesDir
  : nestedUnderMailTemplatesDir;

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
          dir: templatesDir,
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
