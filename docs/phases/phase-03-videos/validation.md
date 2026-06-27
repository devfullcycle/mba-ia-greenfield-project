---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-06-27T00:00:00-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-06-27T00:00:00-03:00"
issues: []
advisories: []
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._ Every Phase 03 capability bullet maps to at least one decided TD (see `context.md` → Capability Coverage). The queue technology — the only "TBD" left by the project plan — is resolved by TD-01.

### Dependency Gaps

_None._ New libraries are pinned in `library-refs.md`. The worker depends on a system `ffmpeg` binary, fixed in the worker image (TD-04). Redis (TD-01) and MinIO (TD-02) are new Compose services declared in SI-03.1.

### Inherited Constraint Conflicts

_None._ The phase reuses Fase 01 config conventions (`registerAs` + Joi) and Fase 02 conventions (global `JwtAuthGuard` + `@Public()`, `DomainExceptionFilter`, TypeORM entity/migration rules) without altering them.

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._ Video UI is deferred to Fase 04/05; this phase is backend-only (see `context.md` → Non-UI / Deferred Capabilities).

## Resolved Issues

The following items were raised during validation and closed in the resolve stage before the plan was built:

- **R-1 — Storage anonymous access vs. private bucket.** Streaming/download must work for anonymous users (no auth), but the bucket must stay private (TD-02/TD-06). Resolved: the API range-proxy (TD-06) serves bytes; the stream/download endpoints are `@Public()`, storage credentials never reach the client.
- **R-2 — API ↔ Worker queue connection sharing.** Both the API (producer) and the worker (consumer) must reach the same Redis with the same queue name. Resolved: a single `queue.config.ts` namespace + a shared `VIDEO_PROCESSING_QUEUE` constant consumed by both processes; host is the Compose service name `redis`.
- **R-3 — Library version pinning without context7.** The context7 MCP server is not connected in this environment. Resolved: versions pinned from the npm registry and official docs (June 2026) and recorded in `library-refs.md` with an explicit note; the installed versions in `package-lock.json` after `npm install` are the source of truth and must be reconciled against the pins.
- **R-4 — Idempotent processing under at-least-once delivery.** BullMQ guarantees at-least-once delivery, so a job may run twice. Resolved: the processing job is keyed by `videoId`; the worker only transitions `processing → ready/error` and is safe to re-run (re-derives metadata/thumbnail deterministically).
