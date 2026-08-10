import ffmpeg from 'fluent-ffmpeg';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { Video } from '../videos/entities/video.entity';
import { VideoProcessingConsumer } from './video-processing.consumer';

jest.mock('fluent-ffmpeg', () => {
  const command: { screenshots: jest.Mock; on: jest.Mock } = {
    screenshots: jest.fn(),
    on: jest.fn(),
  };
  command.screenshots.mockReturnValue(command);
  command.on.mockReturnValue(command);

  const fn = jest.fn().mockReturnValue(command) as unknown as {
    (input: string): typeof command;
    ffprobe: jest.Mock;
    __mockCommand: typeof command;
  };
  fn.ffprobe = jest.fn();
  fn.__mockCommand = command;
  return fn;
});

jest.mock('node:fs/promises', () => ({
  mkdtemp: jest.fn(),
  readFile: jest.fn(),
  rm: jest.fn(),
}));

function makeVideo(overrides: Partial<Video> = {}): Video {
  const video = new Video();
  video.id = 'video-1';
  video.channel_id = 'channel-1';
  video.status = 'processing';
  video.original_filename = 'movie.mp4';
  video.mime_type = 'video/mp4';
  video.size_bytes = '1000';
  video.original_key = 'videos/channel-1/video-1/original.mp4';
  video.upload_id = null;
  video.thumbnail_key = null;
  video.duration_seconds = null;
  video.failure_reason = null;
  video.created_at = new Date();
  video.updated_at = new Date();
  return Object.assign(video, overrides);
}

describe('VideoProcessingConsumer', () => {
  let findOneByOrFail: jest.Mock;
  let update: jest.Mock;
  let presignGetObject: jest.Mock;
  let putObject: jest.Mock;
  let buildThumbnailKey: jest.Mock;
  let consumer: VideoProcessingConsumer;

  beforeEach(() => {
    jest.clearAllMocks();

    findOneByOrFail = jest.fn().mockResolvedValue(makeVideo());
    update = jest.fn().mockResolvedValue(undefined);
    presignGetObject = jest.fn().mockResolvedValue('https://presigned-get-url');
    putObject = jest.fn().mockResolvedValue(undefined);
    buildThumbnailKey = jest.fn(
      (channelId: string, videoId: string) =>
        `videos/${channelId}/${videoId}/thumbnail.jpg`,
    );

    (ffmpeg.ffprobe as jest.Mock).mockImplementation(
      (_url: string, cb: (err: unknown, data: unknown) => void) => {
        cb(null, {
          format: {
            duration: 125.6,
            format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
            bit_rate: '512000',
          },
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              width: 1920,
              height: 1080,
            },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
        });
      },
    );

    const command = (ffmpeg as unknown as jest.Mock)(
      'https://presigned-get-url',
    ) as { screenshots: jest.Mock; on: jest.Mock };
    command.on.mockImplementation(
      (event: string, listener: (...args: unknown[]) => void) => {
        if (event === 'end') {
          listener();
        }
        return command;
      },
    );

    (mkdtemp as jest.Mock).mockResolvedValue('/tmp/streamtube-thumbnail-x');
    (readFile as jest.Mock).mockResolvedValue(Buffer.from('jpeg-bytes'));
    (rm as jest.Mock).mockResolvedValue(undefined);

    consumer = new VideoProcessingConsumer(
      { findOneByOrFail, update } as any,
      { presignGetObject, putObject, buildThumbnailKey } as any,
      {} as any,
    );
  });

  describe('handle', () => {
    it('sets status ready with duration and thumbnail key on success', async () => {
      await consumer.handle({
        videoId: 'video-1',
        bucket: 'streamtube-videos',
        key: 'videos/channel-1/video-1/original.mp4',
      });

      expect(presignGetObject).toHaveBeenCalledWith(
        'videos/channel-1/video-1/original.mp4',
        'inline',
      );
      expect(putObject).toHaveBeenCalledWith(
        'videos/channel-1/video-1/thumbnail.jpg',
        expect.any(Buffer),
        'image/jpeg',
      );
      expect(update).toHaveBeenCalledWith('video-1', {
        status: 'ready',
        duration_seconds: 126,
        metadata: {
          formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
          bitRate: 512000,
          video: { codec: 'h264', width: 1920, height: 1080 },
          audio: { codec: 'aac' },
        },
        thumbnail_key: 'videos/channel-1/video-1/thumbnail.jpg',
      });
    });
  });

  describe('handleFailure', () => {
    it('sets status failed with the given failure reason', async () => {
      await consumer.handleFailure('video-1', 'ffmpeg exited with code 1');

      expect(update).toHaveBeenCalledWith('video-1', {
        status: 'failed',
        failure_reason: 'ffmpeg exited with code 1',
      });
    });
  });
});
