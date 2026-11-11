import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChannelsService } from '../channels/channels.service';
import { VideoProcessingQueue } from '../queue/video-processing.queue';
import { StorageInvalidPartsError } from '../storage/storage.errors';
import { StorageService } from '../storage/storage.service';
import {
  InvalidUploadPartsException,
  VideoNotFoundException,
  VideoNotInDraftException,
} from '../common/exceptions/domain.exception';
import type { CompleteUploadResponseDto } from './dto/complete-upload-response.dto';
import type { CompleteUploadDto } from './dto/complete-upload.dto';
import type { InitiateUploadResponseDto } from './dto/initiate-upload-response.dto';
import type { InitiateUploadDto } from './dto/initiate-upload.dto';
import type { RenewPartsResponseDto } from './dto/renew-parts-response.dto';
import type { RenewPartsDto } from './dto/renew-parts.dto';
import type { Video } from './entities/video.entity';
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
    private readonly processingQueue: VideoProcessingQueue,
  ) {}

  private readonly logger = new Logger(VideoUploadsService.name);

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
    const partNumbers = Array.from(
      { length: plan.part_count },
      (_, index) => index + 1,
    );
    return {
      id: publicId,
      status: 'DRAFT',
      ...plan,
      ...(await this.presignParts(storageKey, uploadId, partNumbers)),
    };
  }

  /** Re-signs part URLs of a DRAFT upload (resumed upload or expired URLs). */
  async renewParts(
    publicId: string,
    userId: string,
    dto: RenewPartsDto,
  ): Promise<RenewPartsResponseDto> {
    const video = await this.findOwnedDraft(publicId, userId);
    const { part_count } = computeUploadPlan(video.size_bytes);
    if (dto.part_numbers.some((partNumber) => partNumber > part_count)) {
      throw new InvalidUploadPartsException();
    }
    return this.presignParts(
      video.storage_key,
      video.upload_id!,
      dto.part_numbers,
    );
  }

  /**
   * Finalizes the multipart upload, persists PROCESSING and only then enqueues
   * processing. The DB is the source of truth: a failed enqueue is logged and
   * left to the reconciler, so the client still gets 202.
   */
  async complete(
    publicId: string,
    userId: string,
    dto: CompleteUploadDto,
  ): Promise<CompleteUploadResponseDto> {
    const video = await this.findOwnedDraft(publicId, userId);

    try {
      await this.storage.completeMultipartUpload(
        video.storage_key,
        video.upload_id!,
        dto.parts.map((part) => ({
          partNumber: part.part_number,
          etag: part.etag,
        })),
      );
    } catch (err) {
      if (err instanceof StorageInvalidPartsError) {
        throw new InvalidUploadPartsException();
      }
      throw err;
    }

    const moved = await this.videosRepository.transitionStatus(
      video.id,
      'DRAFT',
      'PROCESSING',
    );
    if (!moved) {
      throw new VideoNotInDraftException();
    }

    try {
      await this.processingQueue.enqueue(video.id);
    } catch (err) {
      this.logger.error(
        `Enqueue failed for video ${video.id}; the reconciler will retry`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return { id: publicId, status: 'PROCESSING' };
  }

  /**
   * Cancels a DRAFT upload: aborts the multipart upload and removes the row.
   *
   * Storage goes first so a 204 means nothing is left behind, and a transient
   * storage failure keeps the row for a retry. The abort is idempotent, and
   * aborting an upload a concurrent complete already finished is a no-op, so
   * the conditional delete decides the race: 0 rows means the video left DRAFT.
   */
  async abort(publicId: string, userId: string): Promise<void> {
    const video = await this.findOwnedDraft(publicId, userId);
    await this.storage.abortMultipartUpload(
      video.storage_key,
      video.upload_id!,
    );
    const deleted = await this.videosRepository.deleteDraft(video.id);
    if (!deleted) {
      throw new VideoNotInDraftException();
    }
  }

  /**
   * Resolves a DRAFT video owned by `userId`. Unknown ids and other users'
   * videos are indistinguishable (404, never 403).
   */
  async findOwnedDraft(publicId: string, userId: string): Promise<Video> {
    if (this.publicIds.decode(publicId) === null) {
      throw new VideoNotFoundException();
    }
    const video =
      await this.videosRepository.findByPublicIdWithChannel(publicId);
    if (!video || video.channel.user_id !== userId) {
      throw new VideoNotFoundException();
    }
    if (video.status !== 'DRAFT') {
      throw new VideoNotInDraftException();
    }
    return video;
  }

  private async presignParts(
    storageKey: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<RenewPartsResponseDto> {
    const issuedAt = Date.now();
    const parts = await this.storage.presignUploadParts(
      storageKey,
      uploadId,
      partNumbers,
      UPLOAD_URL_TTL_SECONDS,
    );
    return {
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
