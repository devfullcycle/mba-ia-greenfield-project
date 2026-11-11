import {
  classifyProcessingError,
  processingBackoff,
  thumbnailTimestamp,
} from './processing-policy';
import {
  FfmpegProcessError,
  FfmpegTimeoutError,
  NoDurationError,
  NoVideoStreamError,
} from './processing.errors';

describe('thumbnailTimestamp', () => {
  it.each([
    [0.05, 0],
    [1, 0.1],
    [100, 10],
  ])('should pick a frame inside a %ss video (%ss)', (duration, expected) => {
    expect(thumbnailTimestamp(duration)).toBeCloseTo(expected, 6);
  });

  it('should never go past the end of the video', () => {
    expect(thumbnailTimestamp(0.5)).toBeLessThanOrEqual(0.5 - 0.1);
  });
});

describe('classifyProcessingError', () => {
  const ffprobeFailure = (stderr: string, exitCode: number | null = 1) =>
    new FfmpegProcessError('ffprobe', exitCode, stderr);

  it.each(['Invalid data found when processing input', 'moov atom not found'])(
    'should classify ffprobe stderr "%s" as permanent INVALID_FILE',
    (stderr) => {
      expect(
        classifyProcessingError(ffprobeFailure(`input.mp4: ${stderr}`)),
      ).toEqual({
        kind: 'permanent',
        reason: 'INVALID_FILE',
      });
    },
  );

  it('should classify a missing video stream as permanent NO_VIDEO_STREAM', () => {
    expect(classifyProcessingError(new NoVideoStreamError())).toEqual({
      kind: 'permanent',
      reason: 'NO_VIDEO_STREAM',
    });
  });

  it('should classify a missing duration as permanent NO_DURATION', () => {
    expect(classifyProcessingError(new NoDurationError())).toEqual({
      kind: 'permanent',
      reason: 'NO_DURATION',
    });
  });

  it.each([
    'Connection refused',
    'Server returned 403 Forbidden (access denied)',
    'Connection timed out',
  ])('should classify network stderr "%s" as infra', (stderr) => {
    expect(classifyProcessingError(ffprobeFailure(stderr))).toEqual({
      kind: 'infra',
    });
  });

  it('should classify invalid-data stderr mixed with a network error as infra', () => {
    expect(
      classifyProcessingError(
        ffprobeFailure(
          'Connection refused\nInvalid data found when processing input',
        ),
      ),
    ).toEqual({ kind: 'infra' });
  });

  it('should classify an ffmpeg (not ffprobe) failure as infra', () => {
    expect(
      classifyProcessingError(
        new FfmpegProcessError(
          'ffmpeg',
          1,
          'Invalid data found when processing input',
        ),
      ),
    ).toEqual({ kind: 'infra' });
  });

  it('should classify timeouts and unknown errors as infra', () => {
    expect(
      classifyProcessingError(new FfmpegTimeoutError('ffprobe', 1000)),
    ).toEqual({ kind: 'infra' });
    expect(classifyProcessingError(new Error('boom'))).toEqual({
      kind: 'infra',
    });
    expect(classifyProcessingError('not even an error')).toEqual({
      kind: 'infra',
    });
  });
});

describe('processingBackoff', () => {
  it.each([
    [1, 30_000],
    [2, 60_000],
    [3, 120_000],
    [7, 1_920_000],
    [8, 3_600_000],
    [50, 3_600_000],
  ])(
    'should wait the expected delay after attempt %d (%dms)',
    (attempt, delay) => {
      expect(processingBackoff(attempt)).toBe(delay);
    },
  );
});
