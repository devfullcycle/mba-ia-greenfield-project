# phase-03-videos — Library References

Libraries newly introduced (or newly relevant) in Phase 03, with the version line to install and the key APIs the plan relies on.

> **context7 note:** the `context7` MCP server is **not connected** in this environment, so documentation could not be fetched through it as `CLAUDE.md` prescribes. Versions below were pinned from the public npm registry and each library's official documentation (as of June 2026) and cross-checked via web search. After `npm install`, the resolved versions in `nestjs-project/package-lock.json` are the source of truth — reconcile any discrepancy against these pins before relying on an API, per `CLAUDE.md` → "Library Documentation Lookup".

## Queue — TD-01

| Package | Version line | Role |
|---------|--------------|------|
| `bullmq` | `^5.x` | Redis-backed job queue core. |
| `@nestjs/bullmq` | `^11.x` | NestJS integration: `BullModule.forRootAsync`, `BullModule.registerQueue`, `@Processor` + `WorkerHost`. |

**Key APIs used:**
- `BullModule.forRootAsync({ inject:[queueConfig.KEY], useFactory: cfg => ({ connection: { host, port } }) })` — Redis connection (host = `redis`).
- `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })` — register the producer queue.
- Producer: inject `@InjectQueue(VIDEO_PROCESSING_QUEUE) queue: Queue`; `queue.add(jobName, { videoId }, { attempts, backoff })`.
- Consumer (worker): `@Processor(VIDEO_PROCESSING_QUEUE) class VideoProcessor extends WorkerHost { async process(job) {...} }`.
- Retry/backoff: per-job `{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }`; `job.attemptsMade` / final-failure detection for the terminal `error` transition.
- Redis driver `ioredis` is a transitive dependency of `bullmq` — no direct install needed.

## Object Storage — TD-02, TD-03, TD-06

| Package | Version line | Role |
|---------|--------------|------|
| `@aws-sdk/client-s3` | `^3.x` | S3 client; works against MinIO with `forcePathStyle: true`. |
| `@aws-sdk/s3-request-presigner` | `^3.x` | `getSignedUrl()` for presigned part URLs. |

**Key APIs used:**
- `new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } })` — endpoint = `http://minio:9000` inside the network.
- Multipart (TD-03): `CreateMultipartUploadCommand` → `getSignedUrl(client, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }))` per part → `CompleteMultipartUploadCommand({ MultipartUpload: { Parts: [{ ETag, PartNumber }] } })`; `AbortMultipartUploadCommand` for cleanup. Min part size 5MB (except last); presigned URLs default 15 min — set `expiresIn` explicitly.
- Streaming/download (TD-06): `GetObjectCommand({ Bucket, Key, Range })` returns a streamable body + `ContentLength`/`ContentRange`; `HeadObjectCommand` for size/content-type.
- Bucket provisioning: `HeadBucketCommand`/`CreateBucketCommand` on startup (MinIO starts empty).

## Video Processing — TD-04

| Dependency | Version line | Role |
|------------|--------------|------|
| `ffmpeg` / `ffprobe` | system binary (Debian `ffmpeg` package in the worker image) | Metadata/duration extraction and single-frame thumbnail. |
| `node:child_process` | Node built-in | Spawn `ffprobe`/`ffmpeg`. |

**Key invocations used:**
- Duration + metadata: `ffprobe -v quiet -print_format json -show_format -show_streams <input>` → parse JSON (`format.duration`, video stream `width`/`height`/`codec_name`).
- Thumbnail: `ffmpeg -ss <ts> -i <input> -frames:v 1 -q:v 2 <output>.jpg` (single frame near the start).
- Spawned via `child_process.spawn`/`execFile` with explicit args (never a shell string — avoids injection).

## Unique URL — TD-05

| Dependency | Version line | Role |
|------------|--------------|------|
| `node:crypto` | Node built-in | `randomBytes(8).toString('base64url')` for the `public_id`. |

No third-party dependency. `nanoid` was rejected (v5 is ESM-only, friction with the project's CommonJS build) — see TD-05.

## Summary — packages to add to `nestjs-project/package.json`

```
@nestjs/bullmq@^11
bullmq@^5
@aws-sdk/client-s3@^3
@aws-sdk/s3-request-presigner@^3
```

No new test-time npm packages are required: storage/queue integration tests run against the real MinIO/Redis Compose services; `ffmpeg` is exercised inside the worker container.
