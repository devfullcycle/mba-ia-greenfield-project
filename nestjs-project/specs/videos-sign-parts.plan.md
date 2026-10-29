---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: nestjs-project/test/videos-sign-parts.e2e-spec.ts
---

# POST /videos/{id}/parts Test Plan

## Application Overview

`POST /videos/{id}/parts` signs presigned `UploadPart` URLs so the browser can upload each part directly to object storage. Only the video owner can call it, and only while the video is `UPLOADING`.

## Test Scenarios

### 1. Sign parts

**Setup:** truncate test DB (`cleanAllTables`); bootstrap `AppModule` with `ValidationPipe`, `DomainExceptionFilter` and `ValidationExceptionFilter`; create two confirmed users (owner and other) with access tokens; the owner initiates an upload via `POST /videos` to obtain a video `id`.

#### 1.1. sign-parts-returns-urls

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. POST /videos/{id}/parts as the owner with body `{ partNumbers: [1, 2] }`
    - expect: status 200
    - expect: body `parts` has two entries, each with `partNumber` and a non-empty `url`
    - expect: body has `expiresInSeconds`

#### 1.2. sign-parts-forbids-non-owner

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. POST /videos/{id}/parts as the other user with body `{ partNumbers: [1] }`
    - expect: status 403
    - expect: body `error` is `"VIDEO_FORBIDDEN"`

#### 1.3. sign-parts-unknown-video

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. POST /videos/unknownid01/parts as the owner with body `{ partNumbers: [1] }`
    - expect: status 404
    - expect: body `error` is `"VIDEO_NOT_FOUND"`

#### 1.4. sign-parts-rejects-video-not-uploading

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. Set the video's `processingStatus` to `PROCESSING` directly in the DB
  2. POST /videos/{id}/parts as the owner with body `{ partNumbers: [1] }`
    - expect: status 409
    - expect: body `error` is `"UPLOAD_NOT_IN_PROGRESS"`

#### 1.5. sign-parts-validates-body

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. POST /videos/{id}/parts as the owner with body `{ partNumbers: [] }`
    - expect: status 400
