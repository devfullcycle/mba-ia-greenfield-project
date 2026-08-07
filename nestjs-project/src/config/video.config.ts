import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  // 10 GB hard ceiling for a single video upload
  maxSizeBytes: parseInt(process.env.VIDEO_MAX_SIZE_BYTES || '10737418240', 10),
  // 100 MB per multipart part (10GB => ~103 parts, well under the 10k S3 limit)
  uploadPartSizeBytes: parseInt(
    process.env.VIDEO_UPLOAD_PART_SIZE_BYTES || '104857600',
    10,
  ),
  // second of the source used to capture the thumbnail frame
  thumbnailTimestampSeconds: parseInt(
    process.env.VIDEO_THUMBNAIL_TIMESTAMP_SECONDS || '1',
    10,
  ),
  // how many videos the worker processes in parallel
  processingConcurrency: parseInt(
    process.env.VIDEO_PROCESSING_CONCURRENCY || '2',
    10,
  ),
  // BullMQ retry attempts before a video is marked as error
  processingAttempts: parseInt(
    process.env.VIDEO_PROCESSING_ATTEMPTS || '5',
    10,
  ),
}));
