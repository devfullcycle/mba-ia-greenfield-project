import 'reflect-metadata';
import { VideosModule } from './videos.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { VideoQueueService } from './video-queue.service';

describe('VideosModule', () => {
  it('registers the videos controller', () => {
    const controllers =
      (Reflect.getMetadata('controllers', VideosModule) as unknown[]) ?? [];
    expect(controllers).toContain(VideosController);
  });

  it('registers the video service and queue producer', () => {
    const providers =
      (Reflect.getMetadata('providers', VideosModule) as unknown[]) ?? [];
    expect(providers).toContain(VideosService);
    expect(providers).toContain(VideoQueueService);
  });
});
