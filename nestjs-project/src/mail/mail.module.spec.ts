import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import appConfig from '../config/app.config';
import mailConfig from '../config/mail.config';
import { MailModule } from './mail.module';

describe('MailModule', () => {
  it('should compile successfully', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig, mailConfig] }),
        MailModule,
      ],
    }).compile();

    expect(module).toBeDefined();
    await module.close();
  }, 15000);
});
