import * as childProcess from 'node:child_process';
import { MediaProbeService } from './media-probe.service';

jest.mock('node:child_process', () => ({
  execFile: jest.fn(),
}));

describe('MediaProbeService (unit)', () => {
  let service: MediaProbeService;
  const execFileMock = childProcess.execFile as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MediaProbeService();
  });

  it('extractMetadata parses ffprobe JSON output and rounds durationSeconds', async () => {
    const ffprobeJson = JSON.stringify({
      streams: [
        {
          width: 1920,
          height: 1080,
          codec_name: 'h264',
          duration: '12.345',
        },
      ],
      format: {
        duration: '12.345',
      },
    });

    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (
          err: Error | null,
          res: { stdout: string; stderr: string },
        ) => void,
      ) => {
        cb(null, { stdout: ffprobeJson, stderr: '' });
      },
    );

    const metadata = await service.extractMetadata('/tmp/sample.mp4');

    expect(metadata).toEqual({
      durationSeconds: 12,
      width: 1920,
      height: 1080,
      codec: 'h264',
    });
    expect(execFileMock).toHaveBeenCalledWith(
      'ffprobe',
      expect.arrayContaining(['-of', 'json', '/tmp/sample.mp4']),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('extractMetadata throws when no valid video stream is present', async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (
          err: Error | null,
          res: { stdout: string; stderr: string },
        ) => void,
      ) => {
        cb(null, { stdout: JSON.stringify({ streams: [] }), stderr: '' });
      },
    );

    await expect(
      service.extractMetadata('/tmp/audio-only.mp4'),
    ).rejects.toThrow('No valid video stream found in media file');
  });

  it('generateThumbnail invokes ffmpeg with frame extraction arguments', async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (
          err: Error | null,
          res: { stdout: string; stderr: string },
        ) => void,
      ) => {
        cb(null, { stdout: '', stderr: '' });
      },
    );

    await service.generateThumbnail('/tmp/in.mp4', '/tmp/out.jpg', 10);

    expect(execFileMock).toHaveBeenCalledWith(
      'ffmpeg',
      [
        '-y',
        '-ss',
        '1',
        '-i',
        '/tmp/in.mp4',
        '-frames:v',
        '1',
        '-q:v',
        '2',
        '/tmp/out.jpg',
      ],
      expect.any(Object),
      expect.any(Function),
    );
  });
});
