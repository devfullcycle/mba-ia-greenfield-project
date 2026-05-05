import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from './entities/channel.entity';
import { ChannelsService } from './channels.service';

@Module({
  imports: [TypeOrmModule.forFeature([Channel])],
  providers: [ChannelsService],
  exports: [TypeOrmModule, ChannelsService],
})
export class ChannelsModule {}
