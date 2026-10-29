---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: nestjs-project/test/videos-complete-upload.e2e-spec.ts
---

# POST /videos/{id}/complete Test Plan

## Application Overview

`POST /videos/{id}/complete` finishes the multipart upload, verifies the stored object size, moves the video to `PROCESSING` and publishes the `process-video` job. The call is idempotent: repeating it never enqueues a second job.

## Test Scenarios

### 1. Complete upload

**Setup:** truncate test DB (`cleanAllTables`); bootstrap `AppModule` with `ValidationPipe`, `DomainExceptionFilter` and `ValidationExceptionFilter`; create an owner and another confirmed user with access tokens; the owner initiates an upload with a small `sizeBytes`, signs part 1 and uploads the bytes to the returned presigned URL, keeping the returned `ETag`; obtain the BullMQ queue `video-processing` from the test module to inspect jobs.

#### 1.1. complete-upload-moves-to-processing-and-enqueues

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. POST /videos/{id}/complete as the owner with body `{ parts: [{ partNumber: 1, etag: "<ETag>" }] }`
    - expect: status 202
    - expect: body `processingStatus` is `"PROCESSING"`
  2. Count jobs named `process-video` in the queue for this video
    - expect: exactly one job whose payload is `{ videoId }` for this video's internal id

#### 1.2. complete-upload-is-idempotent

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. POST /videos/{id}/complete twice as the owner with the same body
    - expect: both calls return status 202
    - expect: the queue still contains exactly one `process-video` job for this video

#### 1.3. complete-upload-detects-size-mismatch

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. Initiate a second upload declaring `sizeBytes` larger than the bytes actually uploaded in part 1, then upload part 1
  2. POST /videos/{id}/complete as the owner for that video
    - expect: status 409
    - expect: body `error` is `"UPLOAD_INCOMPLETE"`

#### 1.4. complete-upload-forbids-non-owner

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. POST /videos/{id}/complete as the other user
    - expect: status 403
    - expect: body `error` is `"VIDEO_FORBIDDEN"`
