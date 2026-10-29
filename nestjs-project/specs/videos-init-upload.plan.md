---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: nestjs-project/test/videos-init-upload.e2e-spec.ts
---

# POST /videos Test Plan

## Application Overview

`POST /videos` starts an upload: it validates the declared file metadata, creates the `Video` as a draft (`processingStatus = UPLOADING`, `publicationState = DRAFT`) and opens the S3 multipart upload. Only authenticated users can call it.

## Test Scenarios

### 1. Init upload

**Setup:** truncate test DB (`cleanAllTables`); bootstrap `AppModule` with `ValidationPipe`, `DomainExceptionFilter` and `ValidationExceptionFilter` (same bootstrap as `test/auth.e2e-spec.ts`); register and log in a confirmed user to obtain an access token.

#### 1.1. init-upload-returns-draft-with-part-plan

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. POST /videos with a valid bearer token and body `{ originalFilename: "clip.mp4", contentType: "video/mp4", sizeBytes: 1073741824 }`
    - expect: status 201
    - expect: body has `id`, `partSizeBytes`, `partCount` and `processingStatus: "UPLOADING"`
    - expect: `partCount` equals `ceil(sizeBytes / partSizeBytes)`
  2. Query the `videos` table for the returned `id` as `publicId`
    - expect: one row with `publicationState = "DRAFT"` and a non-null `uploadId`

#### 1.2. init-upload-rejects-oversize-file

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. POST /videos with a valid token and `sizeBytes: 10737418241`
    - expect: status 413
    - expect: body `error` is `"VIDEO_TOO_LARGE"`
    - expect: no row was created in `videos`

#### 1.3. init-upload-rejects-unsupported-type

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. POST /videos with a valid token and `contentType: "application/pdf"`, `originalFilename: "doc.pdf"`
    - expect: status 415
    - expect: body `error` is `"UNSUPPORTED_VIDEO_TYPE"`

#### 1.4. init-upload-requires-authentication

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. POST /videos without an Authorization header and with a valid body
    - expect: status 401

#### 1.5. init-upload-validates-body

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. POST /videos with a valid token and a body missing `originalFilename`
    - expect: status 400
