import { HttpException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { StorageService } from './storage/storage.service';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { PresignedPartsDto } from './dto/presigned-parts.dto';
import { StartUploadDto } from './dto/start-upload.dto';
import {
  InvalidVideoUploadException,
  VideoNotFoundException,
  VideoUploadConflictException,
  VideoUploadForbiddenException,
} from './videos.exceptions';
import { Video } from './entities/video.entity';
import { VideoStatus } from './enums/video-status.enum';

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    private readonly storageService: StorageService,
    @InjectQueue('video-processing')
    private readonly videoQueue: Queue,
  ) {}

  async createVideo(userId: string, dto: CreateVideoDto) {
    const channel = await this.channelRepository.findOneBy({ user_id: userId });
    if (!channel) throw new VideoUploadForbiddenException();

    const video = this.videoRepository.create({
      channel_id: channel.id,
      title: dto.title ?? null,
      mime_type: dto.mime_type,
      file_size: String(dto.file_size),
      status: VideoStatus.DRAFT,
      storage_key: null,
      thumbnail_key: null,
      upload_id: null,
      duration_seconds: null,
      metadata: null,
      processing_error: null,
    });
    const saved = await this.videoRepository.save(video);
    return { id: saved.id, status: saved.status };
  }

  async startUpload(userId: string, videoId: string, dto: StartUploadDto) {
    const video = await this.findOwnedVideo(userId, videoId);
    if (video.status === VideoStatus.UPLOADING && video.upload_id) {
      return {
        id: video.id,
        upload_id: video.upload_id,
        status: video.status,
      };
    }
    if (video.status !== VideoStatus.DRAFT) {
      throw new VideoUploadConflictException();
    }

    const objectKey = `videos/${video.id}/source`;
    await this.storageService.ensureBucket();
    const uploadId = await this.storageService.initiateMultipartUpload(
      objectKey,
      dto.mime_type,
    );

    try {
      video.storage_key = objectKey;
      video.upload_id = uploadId;
      video.status = VideoStatus.UPLOADING;
      await this.videoRepository.save(video);
    } catch (error) {
      await this.storageService.abortMultipartUpload(objectKey, uploadId);
      throw error;
    }

    return { id: video.id, upload_id: uploadId, status: video.status };
  }

  async getPresignedParts(
    userId: string,
    videoId: string,
    dto: PresignedPartsDto,
  ) {
    const video = await this.findOwnedVideo(userId, videoId);
    if (
      video.status !== VideoStatus.UPLOADING ||
      !video.upload_id ||
      !video.storage_key
    ) {
      throw new InvalidVideoUploadException();
    }

    const partNumbers = [...new Set(dto.part_numbers)];
    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        part_number: partNumber,
        url: await this.storageService.getPresignedPartUrl(
          video.storage_key as string,
          video.upload_id as string,
          partNumber,
        ),
      })),
    );
    return { video_id: video.id, parts };
  }

  async completeUpload(
    userId: string,
    videoId: string,
    dto: CompleteUploadDto,
  ) {
    const video = await this.findOwnedVideo(userId, videoId);
    if (
      video.status !== VideoStatus.UPLOADING ||
      !video.upload_id ||
      !video.storage_key
    ) {
      throw new InvalidVideoUploadException();
    }

    const parts = dto.parts
      .map(({ part, etag }) => ({ part, etag }))
      .sort((a, b) => a.part - b.part);
    const uniqueParts = new Set(parts.map(({ part }) => part));
    if (uniqueParts.size !== parts.length || parts[0]?.part !== 1) {
      throw new InvalidVideoUploadException();
    }

    await this.storageService.completeMultipartUpload(
      video.storage_key,
      video.upload_id,
      parts,
    );
    const objectInfo = await this.storageService.statObject(video.storage_key);
    video.file_size = String(objectInfo.size);
    video.upload_id = null;
    video.status = VideoStatus.UPLOADED;
    await this.videoRepository.save(video);

    try {
      await this.videoQueue.add(
        'process-video',
        {
          videoId: video.id,
          storageKey: video.storage_key,
          mimeType: video.mime_type,
        },
        {
          jobId: `video-${video.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: false,
          removeOnFail: false,
        },
      );
      video.status = VideoStatus.PROCESSING;
      await this.videoRepository.save(video);
    } catch (error) {
      return {
        id: video.id,
        status: video.status,
        queued: false,
        queue_error: error instanceof Error ? error.message : 'Queue error',
      };
    }

    return { id: video.id, status: video.status, queued: true };
  }
  async cancelUpload(userId: string, videoId: string): Promise<void> {
    const video = await this.findOwnedVideo(userId, videoId);
    if (video.status === VideoStatus.CANCELLED) return;
    if (![VideoStatus.DRAFT, VideoStatus.UPLOADING].includes(video.status)) {
      throw new VideoUploadConflictException();
    }

    if (video.upload_id && video.storage_key) {
      await this.storageService.abortMultipartUpload(
        video.storage_key,
        video.upload_id,
      );
    }
    video.status = VideoStatus.CANCELLED;
    await this.videoRepository.save(video);
  }

  async getStream(videoId: string, rangeHeader?: string) {
    const video = await this.videoRepository.findOneBy({ id: videoId });
    if (!video || video.status !== VideoStatus.READY || !video.storage_key) {
      throw new VideoNotFoundException();
    }
    const objectInfo = await this.storageService.statObject(video.storage_key);
    const size = Number(objectInfo.size);
    const contentType =
      video.mime_type || objectInfo.metaData?.['content-type'] || 'video/mp4';
    if (!rangeHeader) {
      return {
        stream: await this.storageService.getObject(video.storage_key),
        statusCode: 200,
        headers: {
          'Content-Length': size,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        },
      };
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match || (!match[1] && !match[2]))
      throw new HttpException('Range Not Satisfiable', 416);
    const start = match[1]
      ? Number(match[1])
      : Math.max(0, size - Number(match[2]));
    const end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      start >= size
    ) {
      throw new HttpException('Range Not Satisfiable', 416);
    }
    const boundedEnd = Math.min(end, size - 1);
    return {
      stream: await this.storageService.getObjectRange(
        video.storage_key,
        start,
        boundedEnd - start + 1,
      ),
      statusCode: 206,
      headers: {
        'Content-Length': boundedEnd - start + 1,
        'Content-Range': `bytes ${start}-${boundedEnd}/${size}`,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      },
    };
  }

  async getDownload(videoId: string) {
    const result = await this.getStream(videoId);
    return {
      ...result,
      headers: {
        ...result.headers,
        'Content-Disposition': `attachment; filename="video-${videoId}.mp4"`,
      },
    };
  }
  private async findOwnedVideo(
    userId: string,
    videoId: string,
  ): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
      relations: ['channel'],
    });
    if (!video) throw new VideoNotFoundException();
    if (video.channel.user_id !== userId) {
      throw new VideoUploadForbiddenException();
    }
    return video;
  }
}
