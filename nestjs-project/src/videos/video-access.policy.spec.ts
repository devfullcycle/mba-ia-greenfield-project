import type { Video } from './entities/video.entity';
import { VideoAccessPolicy } from './video-access.policy';
import { ProcessingStatus } from './video.enums';

describe('VideoAccessPolicy', () => {
  const policy = new VideoAccessPolicy();

  it('should allow access to a READY video', () => {
    const video = { processingStatus: ProcessingStatus.READY } as Video;

    expect(policy.canAccess(video)).toBe(true);
  });

  it.each([
    ProcessingStatus.UPLOADING,
    ProcessingStatus.PROCESSING,
    ProcessingStatus.FAILED,
  ])('should deny access to a %s video', (status) => {
    const video = { processingStatus: status } as Video;

    expect(policy.canAccess(video)).toBe(false);
  });
});
