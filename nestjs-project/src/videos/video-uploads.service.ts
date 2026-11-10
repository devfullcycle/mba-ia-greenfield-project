import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from '../storage/storage.service';
import type { InitiateUploadResponseDto } from './dto/initiate-upload-response.dto';
import type { InitiateUploadDto } from './dto/initiate-upload.dto';
import { computeUploadPlan } from './upload-plan';
import { VideoPublicIdService } from './video-public-id.service';
import { UPLOAD_URL_TTL_SECONDS, videoSourceKey } from './videos.constants';
import { VideosRepository } from './videos.repository';

/** Upload handshake: video bytes go straight to storage, never through the API. */
@Injectable()
export class VideoUploadsService {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly videosRepository: VideosRepository,
    private readonly publicIds: VideoPublicIdService,
    private readonly storage: StorageService,
  ) {}

  /** Starts the multipart upload and pre-registers the video as DRAFT. */
  async initiate(
    userId: string,
    dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponseDto> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      // Every user gets a channel at registration; reaching here is an invariant violation.
      throw new Error(`User ${userId} has no channel`);
    }

    // The id is generated here (not by the DB) so the storage key exists before INSERT.
    const id = randomUUID();
    const storageKey = videoSourceKey(id);
    const seq = await this.videosRepository.reserveSeq();
    const publicId = this.publicIds.encode(seq);
    const uploadId = await this.storage.createMultipartUpload(
      storageKey,
      dto.mime_type,
    );

    try {
      await this.videosRepository.insert({
        id,
        seq,
        public_id: publicId,
        channel_id: channel.id,
        title: dto.original_filename,
        status: 'DRAFT',
        original_filename: dto.original_filename,
        mime_type: dto.mime_type,
        size_bytes: dto.size_bytes,
        storage_key: storageKey,
        upload_id: uploadId,
      });
    } catch (err) {
      await this.storage.abortMultipartUpload(storageKey, uploadId);
      throw err;
    }

    const plan = computeUploadPlan(dto.size_bytes);
    const issuedAt = Date.now();
    const parts = await this.storage.presignUploadParts(
      storageKey,
      uploadId,
      Array.from({ length: plan.part_count }, (_, index) => index + 1),
      UPLOAD_URL_TTL_SECONDS,
    );

    return {
      id: publicId,
      status: 'DRAFT',
      ...plan,
      parts: parts.map(({ partNumber, url }) => ({
        part_number: partNumber,
        url,
      })),
      expires_at: new Date(
        issuedAt + UPLOAD_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }
}
