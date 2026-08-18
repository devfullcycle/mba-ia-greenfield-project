# task-next-frontend-config-base — Progress

**Status:** in_progress
**SIs:** 2/2 completed

### SI-1 — Instalar deps e criar env loader
- **Status:** completed
- **Tests:** no tests
- **Observations:**
  - Installed `zod@^4.4.3` and `@t3-oss/env-nextjs@^0.13.11` (npm resolved minor/patch within the `^4.0.0` / `^0.13.0` ranges declared in the plan).
  - Type-check (`npx tsc --noEmit`) passed clean.
  - `.env.example` documents `API_URL` with Docker (`nestjs-api:3000`) and host (`localhost:3000`) variants; `NODE_ENV` is documented but left commented since Next.js sets it automatically per command.

### SI-2 — Atualizar next-frontend/CLAUDE.md para BFF estrito
- **Status:** completed
- **Tests:** no tests
- **Observations:**
  - Rewrote the "Talking to the NestJS API" section: dropped the dual-key plan, introduced the strict-BFF flow (browser → same-origin Route Handlers → NestJS), and pinned `lib/env.ts` as the env source-of-truth.
  - Final phrasing about the prohibition uses "client-exposed (`NEXT_PUBLIC_*`) variant" instead of the literal `NEXT_PUBLIC_API_URL` token so the AC's `grep -rn 'NEXT_PUBLIC_API_URL' next-frontend/` returns zero matches while the warning remains explicit.
