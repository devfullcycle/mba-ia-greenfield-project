---
libs:
  "@nestjs/bullmq":
    version: "^3.1.0"
    context7_id: "nestjs"
    fetched_at: "2026-07-11T11:52:00-03:00"
  "bullmq":
    version: "^5.30.0"
    context7_id: "bullmq"
    fetched_at: "2026-07-11T11:52:00-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1085.0"
    context7_id: "aws-sdk"
    fetched_at: "2026-07-11T11:52:00-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1085.0"
    context7_id: "aws-sdk"
    fetched_at: "2026-07-11T11:52:00-03:00"
  "fluent-ffmpeg":
    version: "^2.1.3"
    context7_id: "fluent-ffmpeg"
    fetched_at: "2026-07-11T11:52:00-03:00"
  "nanoid":
    version: "^3.3.8"
    context7_id: "nanoid"
    fetched_at: "2026-07-11T11:52:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-11T11:51:46-03:00"
---

# Library References

### @nestjs/bullmq and bullmq

BullMQ is used to handle asynchronous background processing queues.

**Usage Pattern in NestJS API:**
```typescript
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class VideosService {
  constructor(@InjectQueue('video-processing') private videoQueue: Queue) {}

  async enqueueProcessing(videoId: string, filePath: string) {
    await this.videoQueue.add('process-video', { videoId, filePath }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}
```

**Worker registration:**
```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  async process(job: Job<{ videoId: string; filePath: string }>): Promise<any> {
    // Process video here...
  }
}
```

---

### @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner

AWS SDK v3 is used to interact with MinIO (S3 compatible) for chunked multipart uploads and range streaming.

**Multipart Upload Initialization and Presigning Chunks:**
```typescript
import { S3Client, CreateMultipartUploadCommand, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT, // http://minio:9000
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
  },
  forcePathStyle: true,
  region: 'us-east-1',
});

// Start upload
const multipart = await s3Client.send(new CreateMultipartUploadCommand({
  Bucket: bucketName,
  Key: objectKey,
  ContentType: contentType,
}));

// Presign a chunk
const url = await getSignedUrl(s3Client, new UploadPartCommand({
  Bucket: bucketName,
  Key: objectKey,
  UploadId: multipart.UploadId,
  PartNumber: partNumber,
}), { expiresIn: 3600 });
```

---

### fluent-ffmpeg

Fluent FFmpeg is a Node.js wrapper around FFmpeg and ffprobe to extract video metadata and generate thumbnails.

**Usage Pattern in Worker:**
```typescript
import * as ffmpeg from 'fluent-ffmpeg';

// Extract metadata
ffmpeg.ffprobe(filePath, (err, metadata) => {
  const duration = metadata?.format?.duration;
  // Save duration...
});

// Generate thumbnail
ffmpeg(filePath)
  .screenshots({
    timestamps: ['10%'], // take thumbnail at 10% mark
    filename: 'thumbnail.jpg',
    folder: tempFolder,
    size: '1280x720',
  })
  .on('end', () => {
    // Upload thumbnail...
  });
```

---

### nanoid

NanoID is used to generate URL-safe, user-friendly, non-sequential video identifiers.

**Usage:**
```typescript
import { customAlphabet } from 'nanoid';
// URL-safe alphabet without confusing characters
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const generateUniqueId = customAlphabet(alphabet, 12); // e.g., 'zK9sL2pQ5rT8'
```
