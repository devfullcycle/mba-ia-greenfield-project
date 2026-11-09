---
libs:
  "@aws-sdk/client-s3":
    version: "3.1163.0"
    context7_id: "/aws/aws-sdk-js-v3/v3.1153.0"
    fetched_at: "2026-11-07T13:20:08Z"
  "@aws-sdk/s3-request-presigner":
    version: "3.1163.0"
    context7_id: "/aws/aws-sdk-js-v3/v3.1153.0"
    fetched_at: "2026-11-07T13:20:08Z"
  "bullmq":
    version: "6.7.0"
    context7_id: "/taskforcesh/bullmq/v6.5.3"
    fetched_at: "2026-11-07T13:20:08Z"
  "@nestjs/bullmq":
    version: "12.0.0"
    context7_id: "/websites/nestjs"
    fetched_at: "2026-11-07T13:20:08Z"
  "@nestjs/schedule":
    version: "12.0.2"
    context7_id: "/nestjs/schedule"
    fetched_at: "2026-11-07T13:20:08Z"
  "sqids":
    version: "0.3.0"
    context7_id: "—"
    fetched_at: "2026-11-07T13:20:08Z"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-07T13:19:00Z"
---

# Library References

### @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner

_Version note: Context7 latest indexed is v3.1153.0; installed target 3.1163.0 (same major, API stable)._

- Used by TD-01 (two `S3Client`s, `forcePathStyle: true`, internal `S3_ENDPOINT=http://minio:9000` / public `S3_PUBLIC_ENDPOINT` only for signing) and TD-04/TD-07/TD-11.
- Presign any command: `getSignedUrl(s3Client, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }), { expiresIn })`. `expiresIn` defaults to 900s — TD-04 needs 6h (`21600`).
- Signing is host-bound: sign part URLs with the **public** client; all server-side ops (`CreateMultipartUpload`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `GetObject` with `Range`) use the internal client.
- `CompleteMultipartUpload` takes `MultipartUpload: { Parts: [{ ETag, PartNumber }] }` — client sends ETags (TD-04).
- `x-amz-*` headers to enforce must go into `unhoistableHeaders`; non-`x-amz` (e.g. `content-type`) into `signableHeaders`.

### bullmq

- Custom id dedups: `queue.add(name, data, { jobId })` — adding an existing id is ignored. Avoid `:` and digit-only ids (TD-09 `jobId = videoId`: UUID is safe).
- `throw new UnrecoverableError(msg)` moves job to failed without retries, overriding `attempts` (TD-09 permanent failures).
- Custom backoff via worker `settings.backoffStrategy: (attemptsMade, type, err) => ms`; return `0` = retry now, `-1` = fail. TD-09: 30s doubling, 1h cap; use large `attempts` for "forever".

### @nestjs/bullmq

- `BullModule.forRootAsync({ imports: [ConfigModule], inject: [...], useFactory: () => ({ connection: { host, port } }) })` — host must be the Compose service name (`redis`).
- `BullModule.registerQueue({ name })`; inject with `@InjectQueue(name) queue: Queue`.
- Consumer: `@Processor(name) class X extends WorkerHost { async process(job: Job) {} }` — register only in `WorkerModule` (TD-03).

### @nestjs/schedule

- `ScheduleModule.forRoot()` (global; exports `SchedulerRegistry`); `@Cron('*/5 * * * *', { name })` on a provider method for the TD-09 reconciler (every 5 min).
- Cron starts at bootstrap unless `disabled`/`initialDelay`; disable in tests to keep runs deterministic.

### sqids

_Discrepancy: Context7 has no entry for the JS library (only Python/PHP ports). API from the npm README (0.3.0)._

- `new Sqids({ alphabet, minLength: 10 }).encode([seq])` / `.decode(id)`. Alphabet is a permanent config value (TD-10) — keep in config, shuffled once.
