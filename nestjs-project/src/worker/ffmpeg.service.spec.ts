import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { FfmpegError, FfmpegService, thumbnailInstant } from './ffmpeg.service';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;
};

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

const spawnMock = spawn as unknown as jest.Mock;

describe('FfmpegService (unit)', () => {
  let service: FfmpegService;
  let child: FakeChild;

  beforeEach(() => {
    service = new FfmpegService();
    child = fakeChild();
    spawnMock.mockReset().mockReturnValue(child);
  });

  afterEach(() => jest.useRealTimers());

  describe('probe', () => {
    it('should parse the ffprobe JSON into duration and metadata', async () => {
      const promise = service.probe('https://storage/video');
      child.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            format: { duration: '12.480000' },
            streams: [{ codec_type: 'video', width: 640 }],
          }),
        ),
      );
      child.emit('close', 0);

      const result = await promise;

      expect(result.durationSeconds).toBe(12.48);
      expect(result.metadata.streams).toEqual([
        { codec_type: 'video', width: 640 },
      ]);
      expect(spawnMock).toHaveBeenCalledWith(
        'ffprobe',
        expect.arrayContaining(['json', 'https://storage/video']),
        expect.anything(),
      );
    });

    it('should reject with the stderr tail when ffprobe exits non-zero', async () => {
      const promise = service.probe('https://storage/not-a-video');
      child.stderr.emit('data', Buffer.from('Invalid data found'));
      child.emit('close', 1);

      await expect(promise).rejects.toThrow(/code 1: Invalid data found/);
    });

    it('should reject when the output has no duration', async () => {
      const promise = service.probe('x');
      child.stdout.emit('data', Buffer.from('{"format":{}}'));
      child.emit('close', 0);

      await expect(promise).rejects.toThrow('no video duration');
    });

    it('should reject when the output is not JSON', async () => {
      const promise = service.probe('x');
      child.stdout.emit('data', Buffer.from('garbage'));
      child.emit('close', 0);

      await expect(promise).rejects.toThrow('invalid JSON');
    });

    it('should kill the process and reject on timeout', async () => {
      jest.useFakeTimers();
      const promise = service.probe('x', { timeoutMs: 1000 });
      const assertion = expect(promise).rejects.toBeInstanceOf(FfmpegError);

      jest.advanceTimersByTime(1000);

      await assertion;
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should reject when the binary cannot be started', async () => {
      const promise = service.probe('x');
      child.emit('error', new Error('spawn ffprobe ENOENT'));

      await expect(promise).rejects.toThrow('failed to start');
    });
  });

  describe('thumbnailInstant', () => {
    it('should use 10% of the duration, capped at 5 seconds', () => {
      expect(thumbnailInstant(20)).toBe(2);
      expect(thumbnailInstant(600)).toBe(5);
    });
  });
});
