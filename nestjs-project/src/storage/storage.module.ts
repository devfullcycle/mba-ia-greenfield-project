import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { s3ClientProvider } from './s3-client.provider';
import { StorageService } from './storage.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [s3ClientProvider, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
