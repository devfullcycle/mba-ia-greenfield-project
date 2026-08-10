# phase-03-videos — Manual Testing Guide

How to exercise the full upload → processing → streaming flow by hand, outside the automated test suite.

## 1. Prerequisites

Start the environment from `nestjs-project/`:

```bash
docker compose up -d
docker compose ps   # db, mailpit, minio, nestjs-api, video-worker must all be "running"
```

If `video-worker` was built before `dist/worker.main.js` existed, rebuild and restart it:

```bash
docker compose exec nestjs-api npm run build
docker compose restart video-worker
```

### Windows hosts file entry (required)

Presigned upload/stream/download URLs returned by the API point at `http://minio:9000` (the Docker Compose service name). For your browser, Postman, or VS Code to resolve that host, add this line to `C:\Windows\System32\drivers\etc\hosts` (edit the file as Administrator):

```
127.0.0.1 minio
```

MinIO's port `9000` is already published to the host (`9000:9000` in `compose.yaml`), so once the name resolves, the request reaches the container directly.

### Sample video file

The worker's `ffprobe`/`ffmpeg` step needs real video bytes. Generate a tiny test clip inside the container — it appears on the host at `nestjs-project/sample.mp4` thanks to the bind-mounted volume:

```bash
docker compose exec nestjs-api ffmpeg -y -f lavfi -i testsrc=duration=3:size=320x240:rate=15 -f lavfi -i sine=frequency=1000:duration=3 -shortest sample.mp4
```

(`sample.mp4` is gitignored — it's a local test artifact, not part of the repo.)

## 2. Testing with `api.http` (recommended)

`nestjs-project/api.http` (VS Code REST Client extension) already has the full flow wired up with auto-captured variables. Sections, in order:

1. **Register / confirm / login** (steps 1-4, pre-existing) — registers a user, confirms the email (fetch the token from Mailpit at http://localhost:8025), logs in, and captures `@accessToken` automatically. A channel is created automatically at registration — no separate "create channel" step exists.
2. **Videos** (steps 10-17, added this phase):
   - **10 — `POST /videos`**: initiates the upload, creates the video row in `draft`, opens a multipart upload in MinIO. Captures `@videoId`.
   - **11 — `POST /videos/:id/upload-part-urls`**: requests a presigned PUT URL for part 1.
   - **12 — `PUT` to the presigned URL**: sent directly to MinIO, not through the API. Copy the URL from step 11's response into the request line, then send it — the request body is `< ./sample.mp4` (REST Client streams the file as the body). Copy the `ETag` response header (with quotes) for the next step.
   - **13 — `POST /videos/:id/complete-upload`**: paste the `ETag` from step 12. Video transitions to `processing` and a job is enqueued.
   - **14 — `GET /videos/:id`**: poll this until `status` becomes `ready` or `failed`. Watch it happen live with:
     ```bash
     docker compose logs -f video-worker
     ```
   - **15 — `GET /videos/:id/stream`**: 302 redirect to a presigned inline-playback URL. Only works once `status` is `ready`.
   - **16 — `GET /videos/:id/download`**: 302 redirect to a presigned attachment-download URL. Only works once `status` is `ready`.
   - **17 — `POST /videos/:id/reprocess`**: clears `failure_reason`, flips a `failed` video back to `processing`, and re-enqueues it.

### Testing the failure path

Upload something that isn't a valid video (any non-video file) instead of `sample.mp4` in step 12. `ffprobe` will fail inside the worker, the video's `status` becomes `failed` with a `failure_reason` populated from the dead-letter queue, and step 17 (`reprocess`) can then be exercised against it.

## 3. Other useful UIs

- **Swagger** — http://localhost:3000/api/docs — browse the full OpenAPI contract and try requests interactively (use the "Authorize" button to paste the bearer token). Cannot perform the direct-to-MinIO `PUT` step (that URL isn't part of this API's contract), so use it alongside `api.http`, not as a full replacement.
- **MinIO Console** — http://localhost:9001 (user/password: `streamtube` / `streamtube123`) — inspect the `streamtube-videos` bucket directly to confirm the original file and the generated thumbnail exist under `videos/<channelId>/<videoId>/`.
- **Mailpit** — http://localhost:8025 — read the confirmation/reset emails sent during registration/password-reset to grab their tokens.

## 4. Video status lifecycle

```
draft ──complete-upload──> processing ──worker success──> ready
                                 │
                                 └──worker exhausts retries──> failed ──reprocess──> processing (loop)
```
