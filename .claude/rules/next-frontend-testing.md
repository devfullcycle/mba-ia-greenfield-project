---
paths:
  - 'next-frontend/**/__tests__/**'
  - 'next-frontend/tests/**'
  - 'next-frontend/**/*.test.ts'
  - 'next-frontend/**/*.test.tsx'
  - 'next-frontend/**/*.integration.test.ts'
  - 'next-frontend/**/*.integration.test.tsx'
  - 'next-frontend/**/*.e2e-spec.ts'
description: 'Test type routing, file placement, forbidden patterns (no real-network Vitest tests)'
---

# next-frontend — Testing Rules

## Forbidden pattern — never hit the upstream API directly

A test file that opens a network connection to the real upstream API **MUST NOT** exist in this project. If you find yourself wanting one, the right tool is:

- **`*.e2e-spec.ts`** (Playwright) — drives the running app, which talks to whatever upstream the running environment is wired to.
- **`*.integration.test.ts`** (Vitest + MSW) — with hand-written handlers under `mocks/handlers.ts` or per-test overrides via `server.use(...)`.

Never write a Vitest test that opens a real `fetch` to the upstream host. The contract for integration tests is "BFF as functions, MSW as fake upstream" — see the MSW rule for the 4-step pattern.

## File placement summary

- **Unit / Integration tests live next to the code they exercise**, in a `__tests__/` directory:
  - `components/<feature>/__tests__/*.test.tsx` for component unit tests.
  - `app/api/<route>/__tests__/*.integration.test.ts` for Route Handler integration tests.
  - `lib/__tests__/*.test.ts` for util unit tests.
- **E2E tests live at the project root**: `next-frontend/tests/*.e2e-spec.ts`.

## DOM rendering opt-in

**DOM rendering opt-in:** o ambiente default `node` não renderiza componentes/páginas. Testes que renderizam JSX/TSX (componentes, páginas — linhas da tabela "Test type selection") devem optar pelo DOM **por arquivo** com o docblock `// @vitest-environment jsdom` no topo do arquivo (`jsdom` e `@testing-library/react` já estão instalados). Sem esse docblock, apenas lógica pura/hooks/utils rodam sob `node`.