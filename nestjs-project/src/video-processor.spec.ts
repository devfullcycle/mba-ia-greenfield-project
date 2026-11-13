import { parseProbeMetadata } from './video-processor';

describe('VideoProcessor', () => {
  it('extracts duration and audio/video streams from ffprobe JSON', () => {
    const metadata = parseProbeMetadata(
      JSON.stringify({
        format: { duration: '12.5', format_name: 'mov,mp4' },
        streams: [
          { codec_type: 'audio', codec_name: 'aac' },
          { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
        ],
      }),
    );

    expect(metadata.durationSeconds).toBe(12.5);
    expect(metadata.videoStream).toEqual(
      expect.objectContaining({ codec_name: 'h264', width: 1280 }),
    );
    expect(metadata.audioStream).toEqual(
      expect.objectContaining({ codec_name: 'aac' }),
    );
  });

  it('rejects ffprobe output without a valid video stream', () => {
    expect(() =>
      parseProbeMetadata(
        JSON.stringify({ format: { duration: '0' }, streams: [] }),
      ),
    ).toThrow('ffprobe did not return a valid video stream');
  });
});
