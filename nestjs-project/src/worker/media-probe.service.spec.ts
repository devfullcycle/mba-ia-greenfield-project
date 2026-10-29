import {
  InvalidMediaError,
  MediaProbeService,
  MediaToolError,
  thumbnailTimestamp,
  type ExecFile,
} from './media-probe.service';

function ffprobeOutput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: { format_name: 'mov,mp4', duration: '12.5', bit_rate: '800000' },
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        avg_frame_rate: '30/1',
      },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
    ...overrides,
  });
}

describe('MediaProbeService', () => {
  let exec: jest.MockedFunction<ExecFile>;
  let service: MediaProbeService;

  beforeEach(() => {
    exec = jest.fn();
    service = new MediaProbeService(exec);
  });

  describe('probe', () => {
    it('should run ffprobe on the input and map duration and metadata', async () => {
      exec.mockResolvedValue({ stdout: ffprobeOutput(), stderr: '' });

      const result = await service.probe('https://storage/video.mp4?sig=1');

      expect(exec).toHaveBeenCalledWith(
        'ffprobe',
        expect.arrayContaining([
          '-show_streams',
          'https://storage/video.mp4?sig=1',
        ]),
        expect.objectContaining({ timeout: expect.any(Number) as number }),
      );
      expect(result).toEqual({
        durationSeconds: 12.5,
        metadata: {
          container: 'mov,mp4',
          bitRate: 800000,
          video: {
            codec: 'h264',
            width: 1920,
            height: 1080,
            frameRate: '30/1',
          },
          audio: { codec: 'aac' },
        },
      });
    });

    it('should report audio as null when the file has no audio stream', async () => {
      exec.mockResolvedValue({
        stdout: ffprobeOutput({
          streams: [{ codec_type: 'video', codec_name: 'vp9' }],
        }),
        stderr: '',
      });

      const result = await service.probe('/tmp/video.webm');

      expect(result.metadata.audio).toBeNull();
    });

    it('should throw InvalidMediaError when there is no video stream', async () => {
      exec.mockResolvedValue({
        stdout: ffprobeOutput({ streams: [{ codec_type: 'audio' }] }),
        stderr: '',
      });

      await expect(service.probe('/tmp/audio.mp4')).rejects.toThrow(
        InvalidMediaError,
      );
    });

    it('should throw InvalidMediaError when the duration is missing or zero', async () => {
      exec.mockResolvedValue({
        stdout: ffprobeOutput({
          format: { format_name: 'mp4', duration: '0' },
        }),
        stderr: '',
      });

      await expect(service.probe('/tmp/video.mp4')).rejects.toThrow(
        InvalidMediaError,
      );
    });

    it('should throw MediaToolError when ffprobe fails and never leak the presigned URL', async () => {
      exec.mockRejectedValue(
        new Error(
          'Command failed: ffprobe -v error https://storage/v.mp4?X-Amz-Signature=secret',
        ),
      );

      let error: unknown;
      try {
        await service.probe('https://storage/v.mp4?X-Amz-Signature=secret');
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(MediaToolError);
      expect((error as Error).message).not.toContain('secret');
      expect((error as Error).message).toContain('<url>');
    });

    it('should throw MediaToolError when ffprobe prints something that is not JSON', async () => {
      exec.mockResolvedValue({ stdout: 'not json', stderr: '' });

      await expect(service.probe('/tmp/video.mp4')).rejects.toThrow(
        MediaToolError,
      );
    });
  });

  describe('extractThumbnail', () => {
    it('should seek to the requested second and write one frame to the output path', async () => {
      exec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.extractThumbnail('/tmp/video.mp4', 1.25, '/tmp/thumb.jpg');

      const [file, args] = exec.mock.calls[0];
      expect(file).toBe('ffmpeg');
      expect(args).toEqual(
        expect.arrayContaining(['-ss', '1.250', '-i', '/tmp/video.mp4']),
      );
      expect(args).toEqual(expect.arrayContaining(['-frames:v', '1']));
      expect(args[args.length - 1]).toBe('/tmp/thumb.jpg');
    });

    it('should throw MediaToolError when ffmpeg fails', async () => {
      exec.mockRejectedValue(new Error('boom'));

      await expect(
        service.extractThumbnail('/tmp/video.mp4', 0, '/tmp/thumb.jpg'),
      ).rejects.toThrow(MediaToolError);
    });
  });
});

describe('thumbnailTimestamp', () => {
  it('should take the frame at 10% of the duration', () => {
    expect(thumbnailTimestamp(100)).toBeCloseTo(10);
  });

  it('should stay inside very short videos', () => {
    expect(thumbnailTimestamp(0.5)).toBeCloseTo(0.05);
    expect(thumbnailTimestamp(0.05)).toBe(0);
  });

  it('should never be negative', () => {
    expect(thumbnailTimestamp(0)).toBe(0);
  });
});
