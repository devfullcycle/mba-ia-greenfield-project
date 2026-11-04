---
libs:
  "@aws-sdk/client-s3":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-28T16:55:27-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-28T16:55:27-03:00"
  "@nestjs/bullmq":
    version: "^11.x"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-10-28T16:56:15-03:00"
  "bullmq":
    version: "^5.x"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-28T16:55:47-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-28T17:01:56-03:00"
---

# Library References — phase-03-videos

Cached Context7 excerpts for libraries decided in Phase 03 (`technical-decisions-phase-03-videos.md`). Refreshed by `/plan-resolve` when a new library is decided or when the cache is missing for an already-decided TD.

---

## @aws-sdk/client-s3 & @aws-sdk/s3-request-presigner

**Version line:** `^3.x` (AWS SDK for JavaScript v3).
**Decided in:** `phase-03-videos/TD-01` (Object Storage Client & Bucket Organization), `phase-03-videos/TD-03` (10GB Upload Strategy via S3 Multipart + Presigned URLs), `phase-03-videos/TD-07` (Byte-Range Streaming & Download).
**Context7 ID:** `/aws/aws-sdk-js-v3`.

### 1. S3Client Initialization (MinIO & AWS S3 Compatible)

```typescript
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: config.region, // e.g. 'us-east-1'
  endpoint: config.endpoint, // e.g. 'http://minio:9000'
  forcePathStyle: true, // required for MinIO path-style bucket resolution
  credentials: {
    accessKeyId: config.accessKey,
    secretAccessKey: config.secretKey,
  },
});

// Ensure bucket exists on module startup:
try {
  await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
} catch {
  await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
}
```

### 2. S3 Multipart Upload & Presigned Part URLs (`@aws-sdk/s3-request-presigner`)

```typescript
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// 1. Initiate multipart upload
const { UploadId } = await s3Client.send(
  new CreateMultipartUploadCommand({
    Bucket: bucketName,
    Key: storageKey,
    ContentType: mimeType,
  }),
);

// 2. Generate presigned URL for an individual part (1-indexed, up to 10,000 parts)
const presignedPartUrl = await getSignedUrl(
  s3Client,
  new UploadPartCommand({
    Bucket: bucketName,
    Key: storageKey,
    UploadId,
    PartNumber: partNumber,
  }),
  { expiresIn: 3600 },
);

// 3. Complete multipart upload with ordered parts ({ PartNumber, ETag })
await s3Client.send(
  new CompleteMultipartUploadCommand({
    Bucket: bucketName,
    Key: storageKey,
    UploadId,
    MultipartUpload: {
      Parts: parts
        .slice()
        .sort((a, b) => a.PartNumber - b.PartNumber)
        .map((p) => ({
          PartNumber: p.PartNumber,
          ETag: p.ETag,
        })),
    },
  }),
);

// 4. Abort multipart upload (cleanup uncompleted parts)
await s3Client.send(
  new AbortMultipartUploadCommand({
    Bucket: bucketName,
    Key: storageKey,
    UploadId,
  }),
);
```

### 3. Single Object Upload, Metadata Check, and Byte-Range Streaming

```typescript
import {
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

// Upload buffer or stream (e.g. generated JPEG thumbnail)
await s3Client.send(
  new PutObjectCommand({
    Bucket: bucketName,
    Key: thumbnailKey,
    Body: bufferOrStream,
    ContentType: 'image/jpeg',
  }),
);

// Verify object existence and size
const head = await s3Client.send(
  new HeadObjectCommand({
    Bucket: bucketName,
    Key: storageKey,
  }),
);

// Stream full object or byte slice (RFC 9110 Range header: "bytes=start-end")
const response = await s3Client.send(
  new GetObjectCommand({
    Bucket: bucketName,
    Key: storageKey,
    ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
  }),
);
const readableStream = response.Body as Readable;
```

---

## @nestjs/bullmq & bullmq

**Version line:** `@nestjs/bullmq ^11.x`, `bullmq ^5.x`.
**Decided in:** `phase-03-videos/TD-02` (Background Job Queue Technology), `phase-03-videos/TD-04` (Video Worker Execution Model), `phase-03-videos/TD-05` (Video Status Lifecycle & Retries).
**Context7 IDs:** `/nestjs/bull`, `/taskforcesh/bullmq`.

### 1. Root & Queue Registration (`BullModule.forRootAsync` / `BullModule.registerQueue`)

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigType } from '@nestjs/config';
import queueConfig from '../config/queue.config';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [queueConfig.KEY],
      useFactory: (queue: ConfigType<typeof queueConfig>) => ({
        connection: {
          host: queue.redisHost,
          port: queue.redisPort,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'video-processing',
    }),
  ],
})
export class VideosModule {}
```

### 2. Enqueueing Jobs (`@InjectQueue`)

```typescript
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class VideosService {
  constructor(
    @InjectQueue('video-processing')
    private readonly videoQueue: Queue,
  ) {}

  async enqueueProcessing(videoId: string, storageKey: string): Promise<void> {
    await this.videoQueue.add(
      'process-video',
      { videoId, storageKey },
      {
        jobId: `video-${videoId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );
  }
}
```

### 3. Consuming Jobs (`@Processor` & `WorkerHost`)

```typescript
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

export interface ProcessVideoJobPayload {
  videoId: string;
  storageKey: string;
}

@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  async process(job: Job<ProcessVideoJobPayload, void, string>): Promise<void> {
    switch (job.name) {
      case 'process-video':
        await this.handleProcessVideo(job);
        return;
      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProcessVideoJobPayload> | undefined, error: Error) {
    if (!job) return;
    this.logger.error(
      `Job ${job.id} for video ${job.data.videoId} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? 1}): ${error.message}`,
    );
  }
}
```
