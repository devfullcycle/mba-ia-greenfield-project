import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import Sqids from 'sqids';
import videoConfig from '../config/video.config';
import { VIDEO_PUBLIC_ID_MIN_LENGTH } from './videos.constants';

/**
 * Bijective seq <-> public_id mapping. Every seq yields a unique id, so
 * public ids never collide and need no retry path.
 */
@Injectable()
export class VideoPublicIdService {
  private readonly sqids: Sqids;

  constructor(@Inject(videoConfig.KEY) config: ConfigType<typeof videoConfig>) {
    this.sqids = new Sqids({
      alphabet: config.publicIdAlphabet,
      minLength: VIDEO_PUBLIC_ID_MIN_LENGTH,
    });
  }

  encode(seq: number): string {
    return this.sqids.encode([seq]);
  }

  /** Returns null unless `publicId` is the canonical encoding of exactly one seq. */
  decode(publicId: string): number | null {
    const numbers = this.sqids.decode(publicId);
    if (numbers.length !== 1) return null;
    const [seq] = numbers;
    return this.encode(seq) === publicId ? seq : null;
  }
}
