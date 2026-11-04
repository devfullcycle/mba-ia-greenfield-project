import { Injectable } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

@Injectable()
export class FfmpegService {
  constructor() {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
    ffmpeg.setFfprobePath(ffprobeInstaller.path);
  }

  async extractMetadata(inputPath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (error, metadata) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }

        const videoStream = metadata.streams.find(
          (stream) => stream.codec_type === 'video',
        );

        resolve({
          duration: Number(metadata.format.duration ?? 0),
          width: videoStream?.width ?? 0,
          height: videoStream?.height ?? 0,
        });
      });
    });
  }

  async generateThumbnail(
    inputPath: string,
    outputPath: string,
    timemarkSeconds: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(timemarkSeconds)
        .frames(1)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (error) =>
          reject(error instanceof Error ? error : new Error(String(error))),
        )
        .run();
    });
  }
}
