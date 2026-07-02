---
libs:
  bullmq:
    version: "^5.79.x"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-07-01T17:10:00-03:00"
  "@nestjs/bullmq":
    version: "^11.0.x"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-07-01T17:10:00-03:00"
  ioredis:
    version: "^5.11.x"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-07-01T17:10:00-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1078.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-07-01T17:10:00-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1078.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-07-01T17:10:00-03:00"
  fluent-ffmpeg:
    version: "^2.1.x"
    context7_id: "/fluent-ffmpeg/node-fluent-ffmpeg"
    fetched_at: "2026-07-01T17:10:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-01T16:41:33-03:00"
---

# phase-03-videos — Library References

Distilled docs for libraries decided in this slice. Pulled via Context7. Re-fetch when the underlying TD changes.

## bullmq + @nestjs/bullmq

**Source:** `/taskforcesh/bullmq` (Context7) — High reputation, 1397 snippets, benchmark 84.56. Maps to `phase-03-videos/TD-01` Decision A and `phase-03-videos/TD-03` Decision A (worker consumption side).

### Registering a queue (producer side — API)

`BullModule.registerQueue` wires a named queue to a Redis connection. Used by `VideosModule` to enqueue processing jobs after `complete-upload`.

```typescript
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        connection: { host: config.host, port: config.port },
      }),
    }),
    BullModule.registerQueue({ name: 'video-processing' }),
  ],
})
export class VideosModule {}
```

Injecting the queue to enqueue a job (producer, in `VideosService`):

```typescript
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class VideosService {
  constructor(@InjectQueue('video-processing') private readonly queue: Queue) {}

  async enqueueProcessing(videoId: string) {
    await this.queue.add(
      'process-video',
      { videoId },
      { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
    );
  }
}
```

### Processor (consumer side — worker)

The worker entrypoint (`main-worker.ts`, per TD-03) registers a `Processor` extending `WorkerHost`. This is the free `@nestjs/bullmq` API — NOT the `-pro` variant (`@taskforcesh/nestjs-bullmq-pro`), which is a separate paid package; do not confuse the two when reading BullMQ docs.

```typescript
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  async process(job: Job<{ videoId: string }>): Promise<void> {
    // ffprobe metadata extraction + screenshot thumbnail generation (see fluent-ffmpeg below)
    // update Video entity status: processing -> ready
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job) {
    // update Video entity status -> failed (per TD-06, after attempts exhausted)
  }
}
```

### Retries with exponential backoff (TD-06 failure handling)

`attempts` + `backoff: { type: 'exponential', delay }` on the job (or as `defaultJobOptions` on the queue) drives the retry cycle before a job lands in `failed`:

```typescript
export interface BackoffOptions {
  type: 'fixed' | 'exponential' | (string & {});
  delay?: number;
  jitter?: number; // 0..1, percentage of jitter
}
```

With `attempts: 3, backoff: { type: 'exponential', delay: 3000 }`, retries fire at ~3s, ~6s, ~12s after each failure before the job is moved to `failed` — this is the point where `VideoProcessor`'s `@OnWorkerEvent('failed')` should flip `Video.status` to `failed` (TD-06).

**Note on Redis client:** BullMQ depends on `ioredis` as its Redis client. No separate manual `ioredis` wiring is needed beyond the `connection` option shown above — `ioredis@^5.11.x` is listed here as the version BullMQ 5.79.x resolves, for `package.json` pinning clarity, not for direct application code usage.

## @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner

**Source:** `/aws/aws-sdk-js-v3` (Context7) — High reputation, 24334 snippets, benchmark 74.79. Maps to `phase-03-videos/TD-02` Decision A (upload) and `phase-03-videos/TD-05` Decision B (presigned read).

### Custom endpoint (MinIO compatibility)

`S3Client` accepts a custom `endpoint` — the same client code targets MinIO locally and S3 in production by only changing config/env, never code:

```typescript
import { S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: config.storage.endpoint, // e.g. http://minio:9000 in Compose, unset for real AWS S3
  region: config.storage.region,
  forcePathStyle: true, // required for MinIO path-style bucket addressing
  credentials: { accessKeyId: config.storage.accessKey, secretAccessKey: config.storage.secretKey },
});
```

### Multipart upload flow (TD-02 — initiate / upload parts / complete)

```typescript
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';

// 1. initiate-upload
const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket, Key }));

// 2. client uploads each part directly to a presigned UploadPartCommand URL (see below) — API never touches bytes

// 3. complete-upload (client reports ETags per part)
await s3.send(new CompleteMultipartUploadCommand({
  Bucket, Key, UploadId,
  MultipartUpload: { Parts: parts.map(p => ({ ETag: p.etag, PartNumber: p.partNumber })) },
}));
```

### Presigned URLs — upload parts and read (stream/download)

`getSignedUrl` from `@aws-sdk/s3-request-presigner` wraps any `*Command` — the same function generates the `UploadPartCommand` URLs the client uploads to (TD-02) and the `GetObjectCommand` URL the API redirects readers to (TD-05):

```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UploadPartCommand, GetObjectCommand } from '@aws-sdk/client-s3';

// Upload part URL (initiate-upload response)
const partUrl = await getSignedUrl(
  s3,
  new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: n }),
  { expiresIn: 3600 },
);

// Read URL (stream/download redirect target, per TD-05 — only when status=ready or requester is owner, per TD-07)
const readUrl = await getSignedUrl(
  s3,
  new GetObjectCommand({ Bucket, Key, ResponseContentDisposition: download ? 'attachment' : undefined }),
  { expiresIn: 900 },
);
```

`expiresIn` defaults to 900 seconds if omitted — set explicitly per use case (longer for multipart parts of a slow 10GB upload, shorter for read redirects).

## fluent-ffmpeg

**Source:** `/fluent-ffmpeg/node-fluent-ffmpeg` (Context7) — Medium reputation, 340 snippets, benchmark 71.17. Maps to `phase-03-videos/TD-03` Decision A (worker metadata/thumbnail extraction).

### Duration/metadata extraction (ffprobe)

```javascript
import ffmpeg from 'fluent-ffmpeg';

ffmpeg.ffprobe(localFilePath, (err, metadata) => {
  if (err) {
    // TD-06: mark video status = failed (unrecoverable — not a valid video file)
    return;
  }
  const durationSeconds = metadata.format.duration;
  // persist duration + metadata onto the Video entity
});
```

### Thumbnail generation (screenshots)

```javascript
ffmpeg(localFilePath)
  .on('filenames', (filenames) => {
    // filenames[0] is the generated thumbnail file name
  })
  .on('end', () => {
    // upload the generated thumbnail to storage (same S3Client as TD-02), then mark status = ready
  })
  .on('error', (err) => {
    // TD-06: mark video status = failed
  })
  .screenshots({
    timestamps: ['10%'], // one frame at 10% of the video duration — avoids black frames at 0:00
    filename: 'thumbnail.png',
    folder: '/tmp/video-processing',
    size: '640x360',
  });
```

### Binary path (worker Docker image)

`ffmpeg`/`ffprobe` binaries are installed system-wide in the worker's Dockerfile (`apt-get install -y ffmpeg`), not via the `ffmpeg-static` npm package (per TD-03's rationale — the Dockerfile already controls the runtime environment deterministically). No `setFfmpegPath`/`setFfprobePath` call is needed when the binaries are on `PATH`, which `apt-get install ffmpeg` guarantees.
