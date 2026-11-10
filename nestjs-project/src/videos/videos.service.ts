import { Injectable } from '@nestjs/common';
import { VideoNotFoundException } from '../common/exceptions/domain.exception';
import type { Video } from './entities/video.entity';
import { VideoPublicIdService } from './video-public-id.service';
import { VideosRepository } from './videos.repository';

/** Read side of videos: visibility rules for public access. */
@Injectable()
export class VideosService {
  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly publicIds: VideoPublicIdService,
  ) {}

  /**
   * The owner sees any status; everyone else only READY. Hidden videos are
   * indistinguishable from missing ones (404).
   */
  async findVisible(
    publicId: string,
    viewerUserId: string | null,
  ): Promise<Video> {
    if (this.publicIds.decode(publicId) === null) {
      throw new VideoNotFoundException();
    }
    const video =
      await this.videosRepository.findByPublicIdWithChannel(publicId);
    if (!video) throw new VideoNotFoundException();

    const isOwner =
      viewerUserId !== null && video.channel.user_id === viewerUserId;
    if (video.status !== 'READY' && !isOwner) {
      throw new VideoNotFoundException();
    }
    return video;
  }
}
