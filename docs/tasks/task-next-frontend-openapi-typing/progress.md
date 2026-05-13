# task-next-frontend-openapi-typing — Progress

**Status:** completed
**SIs:** 6/6 completed

### SI-1 — Spec sourcing under Docker isolation (Setup)
- **Status:** completed
- **Tests:** no tests
- **Observations:**
  - Created `scripts/` directory at repo root (didn't exist before this SI).
  - Sync script ran successfully on host; `diff -q nestjs-project/openapi.json next-frontend/openapi.json` returns exit 0.
  - Commit step from technical action #3 is the user's responsibility (per CLAUDE.md — only commit when explicitly asked).

### SI-2 — Codegen pipeline: install openapi-typescript + npm script + first generation (Setup of TD-03 phase 1)
- **Status:** completed
- **Tests:** no tests
- **Observations:**
  - Created `lib/api/` directory (didn't exist before this SI).
  - `openapi-typescript` resolved to `^7.13.0` (within the `^7.x` pin documented in library-refs.md).
  - Codegen idempotency confirmed via two runs + `diff -q` → exit 0.

### SI-3 — Typed upstream client (Setup of TD-01)
- **Status:** completed
- **Tests:** no tests
- **Observations:**
  - npm default-resolved `openapi-fetch` to `^0.17.0` but library-refs.md pins `^0.13.x`. Re-installed with `npm install openapi-fetch@^0.13.0` to honor the documented pin → resolved to `^0.13.8`. Worth a re-decision in a future task if 0.14+ semantics are wanted.
  - `server-only` was not pre-installed in the project; added as a runtime dep (`^0.0.1`) so the canonical Next.js build-time client/server boundary primitive resolves. Not part of the original Setup snippet's library list, but a hard prerequisite for `import "server-only"`.
  - `docker compose exec next-frontend npx tsc --noEmit` exit 0.

### SI-4 — Contracts barrel (Setup of TD-04)
- **Status:** completed
- **Tests:** no tests
- **Observations:**
  - Barrel intentionally empty (per AC `grep -c '^export type' = 0`); added one `eslint-disable-next-line @typescript-eslint/no-unused-vars` over the `import type { paths }` line so lint stays clean until the first feature SI lands an alias.
  - Verified `tsc --noEmit` exit 0 and `npm run lint` exit 0 inside container.

### SI-5 — CI freshness check workflow (Setup of TD-03 phase 2)
- **Status:** completed
- **Tests:** no tests
- **Observations:**
  - No prior CI infrastructure existed in the repo; defaulted to GitHub Actions per the SI's suggested path `.github/workflows/openapi-freshness.yml`. If the team adopts a different CI platform later, the three-step shape (sync → gen → diff) is portable.
  - Added `actions/setup-node@v4` + `npm ci` inside `next-frontend/` before the codegen step so the `openapi-typescript` CLI is available on the runner (the host environment is not Docker on the runner; running inside a container per next-frontend/CLAUDE.md applies to local development, not CI runners which are themselves the execution environment).
  - No-drift baseline on the current commit verified locally via `bash scripts/sync-openapi.sh && npm run openapi:types && git diff --exit-code` → exit 0.

### SI-6 — MSW handler typing pattern documentation (Setup of TD-05)
- **Status:** completed
- **Tests:** no tests
- **Observations:**
  - New subsection `### MSW Handler Typing Convention` inserted between `### Where MSW lives` and `### Running tests during development` (groups all MSW content contiguously).
  - Extended `### Status — bootstrap pending` with an "Already decided" rider that names `next-frontend-msw-foundation` as the bootstrap owner and pins the TD-05 typing convention as inherited.
  - Added a per-test override example to make the `paths`-indexing pattern executable from documentation (not strictly required by the AC but reduces ambiguity for the next implementer).
