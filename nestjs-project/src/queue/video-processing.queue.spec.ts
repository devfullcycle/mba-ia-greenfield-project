import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { ENQUEUE_TIMEOUT_MS, VIDEO_PROCESSING_QUEUE } from './queue.constants';
import {
  EnqueueTimeoutError,
  VideoProcessingQueue,
} from './video-processing.queue';

describe('VideoProcessingQueue', () => {
  const queue = { add: jest.fn() };
  let producer: VideoProcessingQueue;

  beforeEach(async () => {
    jest.useFakeTimers();
    queue.add.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        VideoProcessingQueue,
        { provide: getQueueToken(VIDEO_PROCESSING_QUEUE), useValue: queue },
      ],
    }).compile();
    producer = module.get(VideoProcessingQueue);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should reject with EnqueueTimeoutError when the queue never answers (Redis down)', async () => {
    queue.add.mockReturnValue(new Promise(() => undefined));

    const pending = producer.enqueue('video-id');
    jest.advanceTimersByTime(ENQUEUE_TIMEOUT_MS);

    await expect(pending).rejects.toBeInstanceOf(EnqueueTimeoutError);
  });

  it('should propagate errors raised by the queue', async () => {
    const failure = new Error('connection refused');
    queue.add.mockRejectedValue(failure);

    await expect(producer.enqueue('video-id')).rejects.toBe(failure);
  });
});
