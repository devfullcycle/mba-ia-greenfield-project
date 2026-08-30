import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { VIDEO_PROCESSING_SERVICE } from './queue.constants';
import { VideoProcessingProducer } from './video-processing.producer';

describe('VideoProcessingProducer', () => {
  it('should emit a video.processing message with the exact payload', async () => {
    const emit = jest.fn().mockReturnValue(of(undefined));
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoProcessingProducer,
        { provide: VIDEO_PROCESSING_SERVICE, useValue: { emit } },
      ],
    }).compile();

    const producer = moduleRef.get(VideoProcessingProducer);

    await producer.emitProcessingJob(
      'video-1',
      'videos/c1/video-1/original.mp4',
    );

    expect(emit).toHaveBeenCalledWith('video.processing', {
      videoId: 'video-1',
      originalKey: 'videos/c1/video-1/original.mp4',
    });
  });

  it('should propagate an error from the broker as a rejected promise', async () => {
    const emit = jest.fn().mockImplementation(() => {
      throw new Error('broker unavailable');
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoProcessingProducer,
        { provide: VIDEO_PROCESSING_SERVICE, useValue: { emit } },
      ],
    }).compile();

    const producer = moduleRef.get(VideoProcessingProducer);

    await expect(producer.emitProcessingJob('video-1', 'key')).rejects.toThrow(
      'broker unavailable',
    );
  });
});
