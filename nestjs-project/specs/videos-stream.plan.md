---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.10
target_file: nestjs-project/test/videos-stream.e2e-spec.ts
---

# GET /videos/{id}/stream Test Plan

## Application Overview

`GET /videos/{id}/stream` is public. For a `READY` video it answers `302` with a presigned GET URL so the player streams straight from object storage; any other state is rejected.

## Test Scenarios

### 1. Stream redirect

**Setup:** truncate test DB (`cleanAllTables`); bootstrap `AppModule` with `ValidationPipe`, `DomainExceptionFilter` and `ValidationExceptionFilter`; insert a `Video` with `processingStatus = READY` whose object exists in storage (uploaded through the storage service), and another with `processingStatus = PROCESSING`.

#### 1.1. stream-redirects-ready-video-without-token

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. GET /videos/{readyId}/stream without an Authorization header, without following redirects
    - expect: status 302
    - expect: `Location` header host is the public storage endpoint

#### 1.2. stream-location-supports-range

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. GET the `Location` URL from the previous redirect with header `Range: bytes=0-99`
    - expect: status 206

#### 1.3. stream-rejects-video-not-ready

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. GET /videos/{processingId}/stream
    - expect: status 409
    - expect: body `error` is `"VIDEO_NOT_READY"`

#### 1.4. stream-unknown-video

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-28T13:14:20Z

**Steps:**
  1. GET /videos/unknownid01/stream
    - expect: status 404
    - expect: body `error` is `"VIDEO_NOT_FOUND"`
