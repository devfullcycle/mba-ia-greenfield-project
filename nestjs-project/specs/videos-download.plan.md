---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.11
target_file: nestjs-project/test/videos-download.e2e-spec.ts
---

# GET /videos/{id}/download Test Plan

## Application Overview

`GET /videos/{id}/download` is public. For a `READY` video it answers `302` with a presigned GET URL that forces a download using the video's original filename; any other state is rejected.

## Test Scenarios

### 1. Download redirect

**Setup:** truncate test DB (`cleanAllTables`); bootstrap `AppModule` with `ValidationPipe`, `DomainExceptionFilter` and `ValidationExceptionFilter`; insert a `Video` with `processingStatus = READY`, `originalFilename = "clip.mp4"` and an existing storage object, and another with `processingStatus = PROCESSING`.

#### 1.1. download-redirects-with-attachment-disposition

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. GET /videos/{readyId}/download without following redirects
    - expect: status 302
  2. GET the `Location` URL
    - expect: status 200
    - expect: `Content-Disposition` header contains `attachment` and `clip.mp4`

#### 1.2. download-rejects-video-not-ready

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. GET /videos/{processingId}/download
    - expect: status 409
    - expect: body `error` is `"VIDEO_NOT_READY"`

#### 1.3. download-unknown-video

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. GET /videos/unknownid01/download
    - expect: status 404
    - expect: body `error` is `"VIDEO_NOT_FOUND"`
