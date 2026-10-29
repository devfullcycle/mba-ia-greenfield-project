import { Injectable } from '@nestjs/common';
import type { Video } from './entities/video.entity';
import { ProcessingStatus } from './video.enums';

/**
 * Single seam deciding who may watch or download a video. For now any visitor
 * may access a `READY` video by its unguessable `publicId` (unlisted model);
 * Phase 04 tightens this when publication state and visibility are introduced.
 */
@Injectable()
export class VideoAccessPolicy {
  canAccess(video: Video): boolean {
    return video.processingStatus === ProcessingStatus.READY;
  }
}
