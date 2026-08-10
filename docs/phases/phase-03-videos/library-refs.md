---
libs:
  "pg-boss":
    version: "^12.x"
    context7_id: "unavailable — context7 MCP tool not reachable in this session; grounded via WebSearch against npm/GitHub instead (see Sourcing note)"
    fetched_at: "2026-07-01T15:40:35-03:00"
  "@aws-sdk/client-s3":
    version: "^3.x"
    context7_id: "unavailable — see Sourcing note"
    fetched_at: "2026-07-01T15:40:35-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.x"
    context7_id: "unavailable — see Sourcing note"
    fetched_at: "2026-07-01T15:40:35-03:00"
  "fluent-ffmpeg":
    version: "^2.1.x"
    context7_id: "unavailable — see Sourcing note"
    fetched_at: "2026-07-01T15:40:35-03:00"
  "nanoid":
    version: "^3.3.8"
    context7_id: "unavailable — see Sourcing note"
    fetched_at: "2026-07-05T00:00:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-01T15:31:10-03:00"
---

# phase-03-videos — Library References

**Sourcing note:** the project's `context7` MCP server (mandated by the root `CLAUDE.md` § "Library Documentation Lookup") is not reachable as a tool in this session — `ToolSearch` returned no `resolve-library-id` / `get-library-docs` tools, re-confirmed on 2026-07-05 (added to `.mcp.json` but not loaded/reachable). The excerpts below were gathered via `WebSearch`/`WebFetch` against each library's npm page, GitHub repo, and current official documentation as a substitute grounding source. **Before implementation**, re-run the context7 lookup for each library once the MCP connection is available, cross-check the installed `package.json` version against these notes, and correct any drift — this file should be treated as a first-pass cache, not a final source of truth.

---

### pg-boss

**Package:** `pg-boss@^12.x` — job queue built directly on PostgreSQL (`SKIP LOCKED`-based polling), no separate broker.

**Relevant surface for TD-01/TD-02:**
- `new PgBoss(connectionString)` + `await boss.start()` / `await boss.stop()` — wire into NestJS lifecycle via `OnModuleInit` / `OnApplicationShutdown` in a `PgBossModule`/`QueueService` provider.
- `boss.send(queueName, data, options)` — enqueues a job; supports `retryLimit`, `retryDelay`, `retryBackoff` per job (feeds TD-07's queue-native retry policy).
- **Transactional enqueue (feeds TD-01's dual-write fix):** `send()` accepts a `db` option — an object exposing `executeSql(sql, params)` — that lets pg-boss run its insert on a caller-supplied connection/transaction instead of opening its own. Wrapping the same TypeORM `QueryRunner`/transaction used to insert the `rascunho` video row lets the video-row insert and the job enqueue commit or roll back atomically, with no outbox pattern needed.
- `boss.work(queueName, handler)` (or `boss.fetch()` for pull-based consumption) on the **worker side** — the `video-worker` container runs its own `PgBoss` instance pointed at the same Postgres database, registering the processing handler.
- No official NestJS wrapper exists (confirmed: no `@nestjs/pg-boss` package) — integration is a thin custom `Injectable` provider, consistent with TD-01's stated con.

**Version note:** current npm `pg-boss` releases are in the 12.x line (ESM-only, requires Node >=22.12). Confirm the installed Node version in the `nestjs-api`/`video-worker` Docker images supports ESM-only `pg-boss` before pinning; if the base image runs an older Node LTS, an earlier `pg-boss` major may be required.

---

### @aws-sdk/client-s3

**Package:** `@aws-sdk/client-s3@^3.x` — official modular AWS SDK v3 S3 client.

**Relevant surface for TD-02/TD-03/TD-06:**
- Client construction: `new S3Client({ region, endpoint: process.env.STORAGE_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } })` — `endpoint` + `forcePathStyle: true` are what let the same client target the `minio` Compose service locally and real AWS S3 in production via env vars only (TD-03's "config swap, not code change" requirement).
- Multipart upload flow (TD-02): `CreateMultipartUploadCommand({ Bucket, Key })` → returns `UploadId`; per-part `UploadPartCommand({ Bucket, Key, UploadId, PartNumber })` (signed individually, see presigner below); finalize with `CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: [{ ETag, PartNumber }, ...] } })` using the ETags the client collected while uploading each part.
- Presigned GET (TD-06): `GetObjectCommand({ Bucket, Key, ResponseContentDisposition: 'inline' | 'attachment' })` signed via the presigner (below); S3/MinIO's native GET handler honors `Range` request headers and returns `206 Partial Content` without extra application code.

**Known MinIO rough edge (already logged in TD-03):** presigned URL signature mismatches can occur against MinIO when `forcePathStyle`/`endpoint`/port aren't configured identically between the signing client and the client actually issuing requests — keep the Compose-internal port consistent everywhere presigned URLs are generated or consumed.

---

### @aws-sdk/s3-request-presigner

**Package:** `@aws-sdk/s3-request-presigner@^3.x` — companion package providing `getSignedUrl(client, command, { expiresIn })`, used against `UploadPartCommand` (TD-02) and `GetObjectCommand` (TD-06) to produce the short-lived URLs the client/browser uses directly, keeping the API off the byte-transfer path in both directions.

---

### fluent-ffmpeg

**Package:** `fluent-ffmpeg@2.1.3` (chainable wrapper over the `ffmpeg`/`ffprobe` binaries).

**Relevant surface for TD-04:**
- Metadata probe: `ffmpeg.ffprobe(filePath, (err, metadata) => { ... })` — returns duration, codec, resolution, and stream info needed for the "extração de duração e metadados" capability.
- Thumbnail extraction: `ffmpeg(filePath).screenshots({ timestamps: [seekSeconds], filename: 'thumbnail.jpg', folder: outputDir })` — captures a single frame at a given offset; `folder` must always be set explicitly.
- Binary path overrides (needed once the `video-worker` Dockerfile installs `ffmpeg`/`ffprobe` at a known path): `Ffmpeg.setFfmpegPath(path)` / `Ffmpeg.setFfprobePath(path)`.

**Maintenance caveat (already logged in the phase-03 `context.md` TD-04 entry):** the upstream `fluent-ffmpeg` GitHub repository is read-only and no longer accepts issues or PRs; the last npm release (`2.1.3`) is several years old. The API is still widely used and functionally correct against current `ffmpeg` binaries for the two operations this phase needs, but re-verify compatibility against the pinned `ffmpeg` binary version in the `video-worker` image during implementation. The community fork `@ts-ffmpeg/fluent-ffmpeg` (actively maintained, TypeScript-first, API-compatible) is the fallback if an incompatibility surfaces.

**ffprobe metadata surface used for the broader "duração e metadados" requirement (TD-04 amendment):** the callback's `data` argument exposes `data.format.duration`, `data.format.format_name`, and `data.format.bit_rate` (container-level), plus `data.streams[]` — each entry has `codec_type` (`'video'` | `'audio'` | ...), and for video streams `codec_name`/`width`/`height`, for audio streams `codec_name`. `probeMetadata()` (this phase's implementation) selects the first video and first audio stream from that array and records exactly these fields — no fields beyond what `fluent-ffmpeg`'s existing single `ffprobe()` call already returns were needed.

---

### nanoid

**Package:** `nanoid@^3.3.8` — used for TD-05's short public video `slug` (11 chars), chosen at v3.x deliberately for CommonJS compatibility.

**Relevant surface for TD-05:**
- `import { nanoid } from 'nanoid'; nanoid(size)` — generates a URL-safe random ID of the given length (default 21 if `size` omitted); this phase always passes an explicit `size` of 11.
- **Version/module-format note:** nanoid v3.x supports `require()`/CommonJS directly. From v4/v5 onward, nanoid is ESM-only — v5 needs Node 22.12+ (or Node 20 with `--experimental-require-module`) for `require()` to work at all, otherwise a dynamic `import()` is required. This project already hit ESM-only friction once with `pg-boss` under Jest's CommonJS-oriented transform (see `pg-boss` entry above); pinning `nanoid` to `^3.3.8` avoids repeating that problem for a second dependency.
- **Collision probability:** no fixed table is published; nanoid's README points to an external calculator (https://zelark.github.io/nano-id-cc/) for evaluating a given alphabet/size combination, and states as a reference point that ~103 trillion v4 UUIDs would be needed for a 1-in-a-billion collision chance at UUID's 122 bits of randomness. nanoid's default alphabet at 11 characters is deliberately combined in this implementation with a unique index + a bounded 5-attempt regenerate-on-collision loop, so exact collision odds are not load-bearing — the unique constraint is the actual correctness guarantee, the short length is only about odds of ever hitting the retry path.
