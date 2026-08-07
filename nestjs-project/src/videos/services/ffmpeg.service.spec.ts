import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { FfmpegService } from './ffmpeg.service';

jest.mock('node:child_process');

const mockSpawn = spawn as unknown as jest.Mock;

function fakeChild(stdout: string, exitCode: number) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', exitCode);
  });
  return child;
}

describe('FfmpegService', () => {
  let service: FfmpegService;

  beforeEach(() => {
    service = new FfmpegService();
    mockSpawn.mockReset();
  });

  it('probes duration and metadata from ffprobe JSON', async () => {
    const json = JSON.stringify({
      format: { duration: '42.7', bit_rate: '800000' },
      streams: [
        { codec_type: 'audio', codec_name: 'aac' },
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
      ],
    });
    mockSpawn.mockReturnValue(fakeChild(json, 0));

    const result = await service.probe('/tmp/in.mp4');

    expect(mockSpawn).toHaveBeenCalledWith(
      'ffprobe',
      expect.arrayContaining(['-show_format', '-show_streams', '/tmp/in.mp4']),
    );
    expect(result.durationSeconds).toBe(43);
    expect(result.metadata).toEqual({
      codec: 'h264',
      width: 1920,
      height: 1080,
      bitRate: 800000,
    });
  });

  it('builds the ffmpeg thumbnail command', async () => {
    mockSpawn.mockReturnValue(fakeChild('', 0));

    await service.extractThumbnail('/tmp/in.mp4', '/tmp/out.jpg', 3);

    expect(mockSpawn).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining([
        '-ss',
        '3',
        '-i',
        '/tmp/in.mp4',
        '-frames:v',
        '1',
        '/tmp/out.jpg',
      ]),
    );
  });

  it('rejects when the process exits non-zero', async () => {
    mockSpawn.mockReturnValue(fakeChild('', 1));
    await expect(service.probe('/tmp/missing.mp4')).rejects.toThrow(
      /ffprobe failed/,
    );
  });
});
