# phase-03-videos — Library References

This document pins the exact library versions, APIs, and configuration patterns confirmed via Context7 documentation lookup for Phase 03.

---

## 1. Object Storage: AWS SDK v3 (`@aws-sdk/client-s3` & `@aws-sdk/s3-request-presigner`)

- **Package:** `@aws-sdk/client-s3@^3.738.0`, `@aws-sdk/s3-request-presigner@^3.738.0`
- **Purpose:** Manage S3 buckets/objects (video binaries, thumbnails) and generate presigned URLs for non-blocking direct uploads and secure downloads.
- **MinIO Integration:** Local development uses MinIO (`http://storage:9000`) with `forcePathStyle: true`.
- **Key APIs:**
  - `S3Client`: Configured with `endpoint`, `region`, `credentials` (`accessKeyId`, `secretAccessKey`), `forcePathStyle: true`.
  - `PutObjectCommand`: Used with `getSignedUrl(s3Client, command, { expiresIn: 3600 })` to issue presigned upload URLs.
  - `GetObjectCommand`: Used for presigned download URLs or streaming object bytes.
  - `HeadObjectCommand`: Validates object existence and content length post-upload.
  - `CreateMultipartUploadCommand`, `UploadPartCommand`, `CompleteMultipartUploadCommand`: For 10GB multi-part uploads if client uploads in chunks.

---

## 2. Queue & Background Processing: BullMQ (`@nestjs/bullmq` & `bullmq` & `ioredis`)

- **Package:** `@nestjs/bullmq@^11.0.2`, `bullmq@^5.41.0`, `ioredis@^5.5.0`
- **Purpose:** Reliable asynchronous video processing queue, worker processing, exponential backoff retries, and job status tracking.
- **Key APIs:**
  - `BullModule.forRootAsync()`: Configures Redis connection (`host: 'redis'`, `port: 6379`).
  - `BullModule.registerQueue({ name: 'video-processing' })`: Registers job queue.
  - `@InjectQueue('video-processing') queue: Queue`: Injectable queue producer in API.
  - `queue.add('process-video', jobData, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })`: Enqueues video job.
  - `@Processor('video-processing')`: Worker class decorator.
  - `@Process('process-video')` or `WorkerHost` class extending `WorkerHost` with `async process(job: Job)` handler method.

---

## 3. Media Metadata & Thumbnail Extraction: `fluent-ffmpeg`

- **Package:** `fluent-ffmpeg@^2.1.3`, `@types/fluent-ffmpeg@^2.1.27`
- **Purpose:** Extract video metadata (duration, resolution, format) via `ffprobe` and generate thumbnail frame via `ffmpeg`.
- **Key APIs:**
  - `ffmpeg.ffprobe(filePath, callback)`: Returns `ffprobeData` containing `format.duration`, `streams[0].width`, `streams[0].height`, `streams[0].codec_name`.
  - `ffmpeg(filePath).screenshots({ count: 1, timestamps: ['1.0'], filename: 'thumb.jpg', folder: tempDir })`: Extracts snapshot frame at 1s timestamp.

---

## 4. Unique Public URL Identifier: `nanoid`

- **Package:** `nanoid@^3.3.8` (v3 CJS compatible)
- **Purpose:** Generate 12-character URL-safe random string (`url_code`) for clean public video links (e.g., `/videos/v7K9mX2pL4qW`).
- **Key APIs:**
  - `customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 12)()` or `nanoid(12)`.
