import type { Readable } from 'stream';

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export interface PresignedPart {
  partNumber: number;
  url: string;
}

export interface ObjectStream {
  body: Readable;
  contentLength: number;
  contentRange?: string;
  contentType?: string;
}

export interface ObjectHead {
  contentLength: number;
  contentType?: string;
  lastModified?: Date;
}
