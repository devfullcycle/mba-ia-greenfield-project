import { assertTransition, VideoStatus } from './video-status';
import { InvalidVideoStateException } from './exceptions/video.exceptions';

describe('assertTransition', () => {
  it('allows the valid lifecycle transitions', () => {
    expect(() =>
      assertTransition(VideoStatus.DRAFT, VideoStatus.PROCESSING),
    ).not.toThrow();
    expect(() =>
      assertTransition(VideoStatus.PROCESSING, VideoStatus.READY),
    ).not.toThrow();
    expect(() =>
      assertTransition(VideoStatus.PROCESSING, VideoStatus.ERROR),
    ).not.toThrow();
  });

  it.each([
    [VideoStatus.READY, VideoStatus.PROCESSING],
    [VideoStatus.READY, VideoStatus.DRAFT],
    [VideoStatus.DRAFT, VideoStatus.READY],
    [VideoStatus.ERROR, VideoStatus.PROCESSING],
    [VideoStatus.PROCESSING, VideoStatus.DRAFT],
  ])('rejects the invalid transition %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(
      InvalidVideoStateException,
    );
  });
});
