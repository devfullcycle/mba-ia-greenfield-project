/** ffprobe/ffmpeg exited with a non-zero code. */
export class FfmpegProcessError extends Error {
  constructor(
    public readonly command: 'ffprobe' | 'ffmpeg',
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(`${command} exited with code ${exitCode}: ${stderr.trim()}`);
    this.name = 'FfmpegProcessError';
  }
}

export class FfmpegTimeoutError extends Error {
  constructor(command: 'ffprobe' | 'ffmpeg', timeoutMs: number) {
    super(`${command} timed out after ${timeoutMs}ms`);
    this.name = 'FfmpegTimeoutError';
  }
}

export class NoVideoStreamError extends Error {
  constructor() {
    super('File has no video stream');
    this.name = 'NoVideoStreamError';
  }
}

export class NoDurationError extends Error {
  constructor() {
    super('File has no positive duration');
    this.name = 'NoDurationError';
  }
}
