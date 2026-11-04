interface MockCommand {
  seekInput: jest.Mock;
  frames: jest.Mock;
  output: jest.Mock;
  on: jest.Mock;
  run: jest.Mock;
  handlers: Record<string, (value?: unknown) => void>;
}

jest.mock('fluent-ffmpeg', () => {
  const handlers: Record<string, (value?: unknown) => void> = {};
  const command: MockCommand = {
    seekInput: jest.fn(),
    frames: jest.fn(),
    output: jest.fn(),
    on: jest.fn(),
    run: jest.fn(),
    handlers,
  };
  command.seekInput.mockReturnValue(command);
  command.frames.mockReturnValue(command);
  command.output.mockReturnValue(command);
  command.on.mockImplementation(
    (event: string, handler: (value?: unknown) => void) => {
      handlers[event] = handler;
      return command;
    },
  );
  command.run.mockImplementation(() => handlers.end?.());

  const ffmpegMock = jest.fn(() => command) as unknown as {
    (input: string): MockCommand;
    setFfmpegPath: jest.Mock;
    setFfprobePath: jest.Mock;
    ffprobe: jest.Mock;
    command: MockCommand;
  };
  ffmpegMock.setFfmpegPath = jest.fn();
  ffmpegMock.setFfprobePath = jest.fn();
  ffmpegMock.ffprobe = jest.fn();
  ffmpegMock.command = command;

  return { __esModule: true, default: ffmpegMock };
});

import ffmpeg from 'fluent-ffmpeg';
import { FfmpegService } from './ffmpeg.service';

const mockedFfmpeg = ffmpeg as unknown as {
  (input: string): MockCommand;
  setFfmpegPath: jest.Mock;
  setFfprobePath: jest.Mock;
  ffprobe: jest.Mock;
  command: MockCommand;
};

describe('FfmpegService', () => {
  let service: FfmpegService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FfmpegService();
  });

  it('configures the ffmpeg and ffprobe binary paths', () => {
    expect(mockedFfmpeg.setFfmpegPath).toHaveBeenCalled();
    expect(mockedFfmpeg.setFfprobePath).toHaveBeenCalled();
  });

  describe('extractMetadata', () => {
    it('returns duration and video dimensions', async () => {
      mockedFfmpeg.ffprobe.mockImplementation(
        (
          _path: string,
          callback: (
            error: Error | null,
            metadata: Record<string, unknown>,
          ) => void,
        ) => {
          callback(null, {
            format: { duration: '42.5' },
            streams: [
              { codec_type: 'audio', width: undefined, height: undefined },
              { codec_type: 'video', width: 1920, height: 1080 },
            ],
          });
        },
      );

      await expect(service.extractMetadata('input.mp4')).resolves.toEqual({
        duration: 42.5,
        width: 1920,
        height: 1080,
      });
    });

    it('rejects when ffprobe fails', async () => {
      mockedFfmpeg.ffprobe.mockImplementation(
        (
          _path: string,
          callback: (error: Error | null, metadata: unknown) => void,
        ) => {
          callback(new Error('invalid file'), null);
        },
      );

      await expect(service.extractMetadata('bad.mp4')).rejects.toThrow(
        'invalid file',
      );
    });
  });

  describe('generateThumbnail', () => {
    it('seeks to the requested time and writes one frame', async () => {
      await service.generateThumbnail('input.mp4', 'thumb.jpg', 5);

      expect(mockedFfmpeg).toHaveBeenCalledWith('input.mp4');
      expect(mockedFfmpeg.command.seekInput).toHaveBeenCalledWith(5);
      expect(mockedFfmpeg.command.frames).toHaveBeenCalledWith(1);
      expect(mockedFfmpeg.command.output).toHaveBeenCalledWith('thumb.jpg');
      expect(mockedFfmpeg.command.run).toHaveBeenCalled();
    });

    it('rejects when ffmpeg emits an error', async () => {
      mockedFfmpeg.command.run.mockImplementationOnce(() => {
        mockedFfmpeg.command.handlers.error?.(new Error('encode failed'));
      });

      await expect(
        service.generateThumbnail('input.mp4', 'thumb.jpg', 5),
      ).rejects.toThrow('encode failed');
    });
  });
});
