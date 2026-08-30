import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { VideoProcessingService } from './video-processing.service';

jest.mock('node:child_process');

function makeFakeChild(
  stdoutData: string,
  exitCode: number,
  stderrData = '',
): any {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    if (stdoutData) child.stdout.emit('data', Buffer.from(stdoutData));
    if (stderrData) child.stderr.emit('data', Buffer.from(stderrData));
    child.emit('close', exitCode);
  });
  return child;
}

function makeVideo(): Video {
  const video = new Video();
  video.id = 'video-uuid';
  video.public_id = 'pub12345678';
  video.channel_id = 'channel-1';
  video.status = VideoStatus.PROCESSANDO;
  video.original_filename = 'video.mp4';
  video.original_key = 'videos/channel-1/video-uuid/original.mp4';
  video.upload_id = null;
  video.thumbnail_key = null;
  video.duration_seconds = null;
  video.width = null;
  video.height = null;
  video.codec = null;
  video.bitrate = null;
  video.size_bytes = null;
  video.processing_error = null;
  video.created_at = new Date();
  video.updated_at = new Date();
  return video;
}

const PROBE_JSON = JSON.stringify({
  streams: [
    { codec_type: 'audio' },
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      bit_rate: '4000000',
    },
  ],
  format: { duration: '12.500000', bit_rate: '4200000' },
});

describe('VideoProcessingService', () => {
  const spawnMock = spawn as jest.Mock;

  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('sets status pronto with metadata and thumbnail_key on the happy path', async () => {
    spawnMock.mockImplementation((command: string) => {
      if (command === 'ffprobe') return makeFakeChild(PROBE_JSON, 0);
      return makeFakeChild('', 0); // ffmpeg
    });

    const video = makeVideo();
    const videoRepository: any = {
      findOneByOrFail: jest.fn().mockResolvedValue(video),
      save: jest.fn((v) => v),
    };
    const storageService: any = {
      downloadToFile: jest.fn().mockResolvedValue(undefined),
      uploadFile: jest.fn().mockResolvedValue(undefined),
    };
    const service = new VideoProcessingService(videoRepository, storageService);

    await service.process('video-uuid', video.original_key!);

    expect(storageService.downloadToFile).toHaveBeenCalledWith(
      video.original_key,
      expect.any(String),
    );
    expect(storageService.uploadFile).toHaveBeenCalledWith(
      'videos/channel-1/video-uuid/thumbnail.jpg',
      expect.any(String),
      'image/jpeg',
    );
    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VideoStatus.PRONTO,
        duration_seconds: 13,
        width: 1920,
        height: 1080,
        codec: 'h264',
        bitrate: 4200000,
        thumbnail_key: 'videos/channel-1/video-uuid/thumbnail.jpg',
      }),
    );
  });

  it('sets status erro with processing_error when ffprobe fails, without uploading a thumbnail', async () => {
    spawnMock.mockImplementation(() =>
      makeFakeChild('', 1, 'Invalid data found when processing input'),
    );

    const video = makeVideo();
    const videoRepository: any = {
      findOneByOrFail: jest.fn().mockResolvedValue(video),
      save: jest.fn((v) => v),
    };
    const storageService: any = {
      downloadToFile: jest.fn().mockResolvedValue(undefined),
      uploadFile: jest.fn(),
    };
    const service = new VideoProcessingService(videoRepository, storageService);

    await service.process('video-uuid', video.original_key!);

    expect(storageService.uploadFile).not.toHaveBeenCalled();
    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: VideoStatus.ERRO }),
    );
    const [savedVideo] = videoRepository.save.mock.calls[0];
    expect(savedVideo.processing_error).toContain(
      'Invalid data found when processing input',
    );
  });

  it('sets status erro when the storage download fails', async () => {
    const video = makeVideo();
    const videoRepository: any = {
      findOneByOrFail: jest.fn().mockResolvedValue(video),
      save: jest.fn((v) => v),
    };
    const storageService: any = {
      downloadToFile: jest
        .fn()
        .mockRejectedValue(new Error('bucket unreachable')),
      uploadFile: jest.fn(),
    };
    const service = new VideoProcessingService(videoRepository, storageService);

    await service.process('video-uuid', video.original_key!);

    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VideoStatus.ERRO,
        processing_error: 'bucket unreachable',
      }),
    );
  });
});
