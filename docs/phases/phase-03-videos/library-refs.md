---
libs:
  "@nestjs/bullmq":
    version: "^12.0.0"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-10-28T09:13:28-03:00"
  bullmq:
    version: "^6.5.0"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-28T09:13:28-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1158.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-28T09:13:28-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1158.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-28T09:13:28-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-28T08:40:20-03:00"
---

# phase-03-videos — Library References

Distilled docs for libraries decided in this slice. Pulled via Context7. Re-fetch when the underlying TD changes.

## @nestjs/bullmq

**Source:** `/nestjs/docs.nestjs.com` (Context7, `application/queues`) — maps to `phase-03-videos/TD-01` Decision A.

Peer deps accept `@nestjs/core`/`@nestjs/common` `^10 || ^11 || ^12` and `bullmq` `^3 – ^6`, so v12 works with the project's Nest 11. (`@nestjs/bullmq@11.0.5` is the last 11.x if pinning to the Nest major is preferred.)

```typescript
// Root connection, async (ConfigService + Joi namespaces; host is the Compose service name, e.g. `redis`)
BullModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: async (configService: ConfigService) => ({
    connection: {
      host: configService.get('QUEUE_HOST'),
      port: configService.get('QUEUE_PORT'),
    },
  }),
  inject: [ConfigService],
});

// Register a named queue (one per feature module that produces/consumes)
BullModule.registerQueue({ name: 'video-processing' });

// Producer
@Injectable()
export class VideoService {
  constructor(@InjectQueue('video-processing') private readonly queue: Queue) {}
}
```

Notes:
- `Queue` type comes from `bullmq`, `@InjectQueue` from `@nestjs/bullmq`.
- Consumer: class decorated with `@Processor('video-processing')` extending `WorkerHost`, implementing `process(job)`; use `@OnWorkerEvent('failed')` for the failure sink. (Not returned verbatim by Context7 for this query — confirm against `application/queues` before coding; docs for v11+ use `connection:`, not the legacy `redis:` key shown on older `@nestjs/bull` pages.)
- `registerQueueAsync()` exists for async per-queue options; `defaultJobOptions` can be set at `registerQueue` level.
- The worker runs from the same codebase in a separate entrypoint (TD-04): it imports the same `BullModule` registration but bootstraps an application context with no HTTP listener.

## bullmq

**Source:** `/taskforcesh/bullmq` (Context7; versions v5.x and v6.x indexed) — maps to `phase-03-videos/TD-01` Decision A.

Job options relevant to `process-video` jobs:

```typescript
await queue.add(
  'process-video',
  { videoId },
  {
    jobId: videoId,                                 // dedupe: same jobId ⇒ only the first add is kept
    attempts: 5,                                    // retries
    backoff: { type: 'exponential', delay: 1000 },  // exponential backoff
    removeOnComplete: true,                         // cleanup after success
    removeOnFail: 100,                              // keep last 100 failed jobs (acts as DLQ view)
  },
);
```

Notes:
- **`jobId` deduplication caveat:** a job removed via `removeOnComplete`/`removeOnFail` no longer counts as existing, so the same `jobId` can be re-added. For idempotent re-enqueue after a finished job, keep completed/failed jobs (or use an age/count window) or guard with the video status in Postgres (TD-06/TD-10).
- Worker events: `worker.on('completed' | 'failed', ...)` (via `@OnWorkerEvent` in Nest). The failed set is the dead-letter view.
- Long jobs (ffprobe/ffmpeg over ≤10GB): the worker lock is renewed automatically; stalled-job recovery re-queues a job whose worker died. Tune `lockDuration`/`stalledInterval` and `concurrency` on the Worker options if needed.
- Repeatable work (stale-upload cleanup, TD-10): use job schedulers — `queue.upsertJobScheduler(schedulerId, { every | pattern }, { name, data, opts })`.
- Redis should run with AOF (`--appendonly yes`) so jobs survive restarts (TD-01 cons).

## @aws-sdk/client-s3

**Source:** `/aws/aws-sdk-js-v3` (Context7, v3.1153) — maps to `phase-03-videos/TD-13` Decision A (S3-compatible engine, SeaweedFS gateway) and TD-02/TD-12 (multipart).

Client for an S3-compatible engine (internal endpoint = Compose service name):

```typescript
const s3 = new S3Client({
  endpoint: config.s3.endpoint,        // internal, e.g. http://seaweedfs:8333
  region: config.s3.region,
  forcePathStyle: true,                // bucket in the path, required by most S3-compatible engines
  credentials: { accessKeyId, secretAccessKey },
});
```

Multipart commands (v3 names; `renamed s3ForcePathStyle → forcePathStyle` vs v2):
- `CreateMultipartUploadCommand({ Bucket, Key, ContentType })` → `UploadId`.
- `UploadPartCommand({ Bucket, Key, UploadId, PartNumber, ... })` → response carries `ETag`; the browser must be able to **read the `ETag` response header** (bucket CORS `ExposeHeaders: ETag`), otherwise the SDK/uploader reports a missing ETag.
- `CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: [{ PartNumber, ETag }, ...] } })` — parts sorted by `PartNumber`.
- `AbortMultipartUploadCommand({ Bucket, Key, UploadId })` for cleanup; also configure the abort-incomplete-multipart lifecycle rule (verify engine support, TD-03/TD-13).
- `HeadObjectCommand({ Bucket, Key })` — verify size/`ContentType` after completion (TD-12); `ListPartsCommand` for resume.
- `GetObjectCommand({ Bucket, Key, Range? })` for worker reads when ffprobe-from-URL fails and the fallback downloads to a temp file.

Public vs internal endpoint (TD-13): keep **two** configured clients (or two endpoint values) — the internal client for API/worker I/O, a signing client built with `S3_PUBLIC_ENDPOINT` for presigned URLs, since the host is part of the signature.

## @aws-sdk/s3-request-presigner

**Source:** `/aws/aws-sdk-js-v3` (Context7, `packages/s3-request-presigner`) — maps to `phase-03-videos/TD-13` Decision A (presign), TD-02 (part URLs), TD-08/TD-09 (stream/download redirects).

```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand, UploadPartCommand, S3Client } from '@aws-sdk/client-s3';

// Part upload URL (TD-02)
const partUrl = await getSignedUrl(
  signingClient,
  new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }),
  { expiresIn: ttlSeconds },
);

// Stream (TD-08)
const streamUrl = await getSignedUrl(signingClient, new GetObjectCommand({ Bucket, Key }), { expiresIn });

// Download (TD-09) — the response-content-disposition override MUST be signed, which presigning does
const downloadUrl = await getSignedUrl(
  signingClient,
  new GetObjectCommand({
    Bucket,
    Key,
    ResponseContentDisposition: `attachment; filename="${safeName}"`,
  }),
  { expiresIn },
);
```

Notes:
- `expiresIn` is in seconds and defaults to **900** if omitted — set it explicitly from the Joi-validated presign TTLs (stream TTL must exceed typical watch time, TD-08).
- `x-amz-*` headers you want enforced on the upload request (e.g. checksums) must be listed in `unhoistableHeaders: new Set([...])`; other non-`x-amz-*` headers go in `signableHeaders`.
- `getSignedUrl` takes the **client** whose endpoint/credentials become part of the signature, hence the public-endpoint signing client above.
