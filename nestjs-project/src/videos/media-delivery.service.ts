import { Injectable } from '@nestjs/common';
import type { Readable } from 'stream';
import { RangeNotSatisfiableException } from '../common/exceptions/domain.exception';
import { StorageInvalidRangeError } from '../storage/storage.errors';
import { StorageService } from '../storage/storage.service';
import type { Video } from './entities/video.entity';

export const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';

export interface MediaResponse {
  status: 200 | 206;
  headers: Record<string, string>;
  body: Readable;
}

/** Proxies media from storage: Range passes through, bytes are never buffered. */
@Injectable()
export class MediaDeliveryService {
  constructor(private readonly storage: StorageService) {}

  async openMedia(video: Video, range?: string): Promise<MediaResponse> {
    try {
      const object = await this.storage.getObjectStream(
        video.storage_key,
        range,
      );
      const headers: Record<string, string> = {
        'Content-Type': video.mime_type,
        'Content-Length': String(object.contentLength),
        'Accept-Ranges': 'bytes',
      };
      if (object.contentRange) headers['Content-Range'] = object.contentRange;
      return {
        status: object.contentRange ? 206 : 200,
        headers,
        body: object.body,
      };
    } catch (err) {
      if (err instanceof StorageInvalidRangeError) {
        throw new RangeNotSatisfiableException(video.size_bytes);
      }
      throw err;
    }
  }

  async openThumbnail(video: Video): Promise<MediaResponse> {
    const object = await this.storage.getObjectStream(video.thumbnail_key!);
    return {
      status: 200,
      headers: {
        'Content-Type': THUMBNAIL_CONTENT_TYPE,
        'Content-Length': String(object.contentLength),
      },
      body: object.body,
    };
  }
}
