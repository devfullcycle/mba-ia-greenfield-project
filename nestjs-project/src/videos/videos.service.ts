import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { ConfigType } from '@nestjs/config';
import { customAlphabet } from 'nanoid';

import { Video, VideoStatus } from './entities/video.entity';
import { StorageService } from './services/storage.service';
import { ChannelsService } from '../channels/channels.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { GetPartUrlDto } from './dto/get-part-url.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadResponseDto } from './dto/initiate-upload-response.dto';
import { CompleteUploadResponseDto } from './dto/complete-upload-response.dto';
import { VideoDetailsResponseDto } from './dto/video-details-response.dto';
import storageConfig from '../config/storage.config';

const ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const generateUniqueId = customAlphabet(ALPHABET, 12);

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly channelsService: ChannelsService,
    @InjectQueue('video-processing')
    private readonly videoQueue: Queue,
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
  ) {}

  async initiateUpload(
    userId: string,
    dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponseDto> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ForbiddenException(
        'User does not have a channel to upload videos',
      );
    }

    const unique_url_id = generateUniqueId();
    const ext = dto.fileName.split('.').pop() || 'mp4';
    const key = `videos/${unique_url_id}/video.${ext}`;

    const { uploadId } = await this.storageService.initializeMultipartUpload(
      this.storageCfg.bucketVideos,
      key,
      dto.mimeType,
    );

    const video = this.videoRepository.create({
      title: dto.title,
      description: dto.description || null,
      unique_url_id,
      status: VideoStatus.DRAFT,
      video_key: key,
      size_bytes: dto.fileSizeBytes,
      mime_type: dto.mimeType,
      channel_id: channel.id,
    });

    const savedVideo = await this.videoRepository.save(video);

    return {
      videoId: savedVideo.id,
      unique_url_id,
      uploadId,
      key,
    };
  }

  async generatePresignedPartUrl(
    userId: string,
    videoId: string,
    dto: GetPartUrlDto,
  ): Promise<{ url: string }> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      throw new NotFoundException('Video not found');
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel || video.channel_id !== channel.id) {
      throw new ForbiddenException('You do not own this video');
    }

    if (video.status !== VideoStatus.DRAFT) {
      throw new BadRequestException('Video upload is not in DRAFT status');
    }

    if (!video.video_key) {
      throw new BadRequestException('Video key is not defined');
    }

    const url = await this.storageService.generatePresignedUploadPartUrl(
      this.storageCfg.bucketVideos,
      video.video_key,
      dto.uploadId,
      dto.partNumber,
    );

    return { url };
  }

  async completeUpload(
    userId: string,
    videoId: string,
    dto: CompleteUploadDto,
  ): Promise<CompleteUploadResponseDto> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      throw new NotFoundException('Video not found');
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel || video.channel_id !== channel.id) {
      throw new ForbiddenException('You do not own this video');
    }

    if (video.status !== VideoStatus.DRAFT) {
      throw new BadRequestException('Video upload is not in DRAFT status');
    }

    if (!video.video_key) {
      throw new BadRequestException('Video key is not defined');
    }

    await this.storageService.completeMultipartUpload(
      this.storageCfg.bucketVideos,
      video.video_key,
      dto.uploadId,
      dto.parts,
    );

    video.status = VideoStatus.PROCESSING;
    await this.videoRepository.save(video);

    // Enqueue transcoding job
    await this.videoQueue.add(
      'process-video',
      {
        videoId: video.id,
        videoKey: video.video_key,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return {
      success: true,
      status: VideoStatus.PROCESSING,
    };
  }

  async getVideoDetails(uniqueUrlId: string): Promise<VideoDetailsResponseDto> {
    const video = await this.videoRepository.findOne({
      where: { unique_url_id: uniqueUrlId },
    });
    if (!video) {
      throw new NotFoundException('Video not found');
    }

    return {
      id: video.id,
      title: video.title,
      description: video.description,
      unique_url_id: video.unique_url_id,
      status: video.status,
      failure_reason: video.failure_reason,
      duration: video.duration,
      size_bytes: video.size_bytes ? Number(video.size_bytes) : null,
      channel_id: video.channel_id,
      created_at: video.created_at,
      updated_at: video.updated_at,
      metadata: video.metadata,
    };
  }

  async findVideoByUrlId(uniqueUrlId: string): Promise<Video | null> {
    return this.videoRepository.findOne({
      where: { unique_url_id: uniqueUrlId },
    });
  }
}
