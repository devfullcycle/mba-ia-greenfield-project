import { Inject, Injectable } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { VIDEO_PROCESSING_SERVICE } from './queue.constants';

@Injectable()
export class VideoProcessingProducer {
  constructor(
    @Inject(VIDEO_PROCESSING_SERVICE)
    private readonly client: ClientProxy,
  ) {}

  async emitProcessingJob(videoId: string, originalKey: string): Promise<void> {
    // ClientProxy#emit() is a "hot" Observable that only reliably publishes
    // once subscribed — awaiting it via lastValueFrom both triggers delivery
    // and surfaces broker errors as a rejected promise.
    await lastValueFrom(
      this.client.emit('video.processing', { videoId, originalKey }),
    );
  }
}
