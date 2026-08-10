import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service';

@Module({
  imports: [ConfigModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule implements OnApplicationBootstrap {
  constructor(private readonly storageService: StorageService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.storageService.initializeBucket();
  }
}
