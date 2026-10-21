---
libs:
  "@aws-sdk/client-s3":
    version: "^3.1154.0"
    installed: "3.1154.0"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1154.0"
    installed: "3.1154.0"
  "pg-boss":
    version: "10.4.2"
    installed: "10.4.2"
  "nanoid":
    version: "^3.3.20"
    installed: "3.3.20"
sources_mtime:
  docs/decisions/technical-decisions-upload-processing.md: "2026-10-21"
---

# Library References — phase-03-upload-processing

Libraries fixed by this phase's decisions (storage TD-01/TD-02/TD-06, queue TD-03, public id TD-05).

> **Source note.** Context7 was not reachable when this file was written (the MCP server disconnected). The notes below were NOT fetched from Context7: they come from the installed packages (`node_modules/<pkg>/package.json`, typings, README), from the SI-03.1 spike recorded in TD-01 Revisions, and from the code that already runs against them in this phase. Re-run `/plan-resolve` with Context7 connected to replace this with cached Context7 excerpts if the exact source is required.

---

## @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner

**Version line:** `^3.1154.0` (both packages share the version).
**Decided in:** `TD-01` (SeaweedFS behind the S3 API), `TD-02` (multipart with presigned part URLs), `TD-06` (presigned GET with Range).
**Used in:** `src/storage/storage.service.ts`.

- Multipart: `CreateMultipartUploadCommand`, `UploadPartCommand` (presigned per part with `getSignedUrl`), `ListPartsCommand`, `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand`, `ListMultipartUploadsCommand`.
- Objects: `HeadObjectCommand` (missing object → `NotFound`/404), `GetObjectCommand` presigned for playback; `ResponseContentDisposition` makes the signed GET serve a named download.
- SigV4 binds the `Host` header, so two clients are needed: an internal endpoint (`http://storage:8333`) for operations and a public one (`http://localhost:8333`) for URLs the browser uses.
- `forcePathStyle: true` is required for SeaweedFS; `requestChecksumCalculation` / `responseChecksumValidation` set to `'WHEN_REQUIRED'` keep flexible-checksum params out of presigned URLs (a browser `PUT` would otherwise have to reproduce them).
- The browser can only read a part's `ETag` if the bucket CORS exposes it; `storage/cors.json` does, applied by the `storage-init` service.
- A presigned URL is valid for one HTTP method: `HEAD` on a URL signed for `GET` returns 403; clients use `GET` with `Range`.

## pg-boss

**Version line:** `10.4.2` (exact).
**Decided in:** `TD-03` (queue on PostgreSQL, transactional enqueue, cron for the reaper).
**Used in:** `src/queue/queue.service.ts`, `src/worker/*`.

- Pinned to v10 on purpose: v12 is ESM-only and this project (and Jest) compile to CommonJS.
- Lifecycle: `new PgBoss(connection)`, `start()` creates the `pgboss` schema; `stop()` is graceful and runs on `SIGTERM` via `enableShutdownHooks()`.
- Queues must exist before use: `createQueue(name, { retryLimit, retryDelay, retryBackoff })`; an existing queue is not altered by a later `createQueue`.
- `send(queue, data, { db })` accepts a custom `db` with `executeSql`, which is how the enqueue joins the TypeORM transaction.
- `work(queue, { includeMetadata: true }, handler)` delivers an array of jobs; with metadata the job carries `retryCount` / `retryLimit`, used to detect the final failed attempt.
- `schedule(queue, cron, data)` stores recurring jobs in `pgboss.schedule` (used for `video.upload.reap`, `0 * * * *`).
- Delivery is at-least-once, so handlers are idempotent.

## nanoid

**Version line:** `^3.3.20` (CommonJS line).
**Decided in:** `TD-05` (random 11-char URL-safe public id with unique index and retry on conflict).
**Used in:** `src/videos/public-id.util.ts`.

- v3 is used because nanoid 5+ is ESM-only and breaks under Jest/CommonJS.
- Default alphabet is URL-safe (`A-Za-z0-9_-`); size 11.

## FFmpeg / ffprobe (system binary, not an npm lib)

**Decided in:** `TD-04`. Installed in `Dockerfile.dev` (`apt install ffmpeg`), invoked through `child_process` in `src/worker/ffmpeg.service.ts`, reading a presigned GET URL (internal endpoint, since the worker runs inside Compose).
