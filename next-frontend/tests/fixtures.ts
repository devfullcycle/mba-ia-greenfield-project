import { test as base, expect } from "@playwright/test";

type NetworkFixtures = {
  network: void;
};

// MSW runs server-side in the containerized Next.js dev server via
// instrumentation.ts (MSW_ENABLED=true). This fixture is auto-applied to
// every E2E test to document that contract. Rules:
//   - Do NOT page.route() /api/** — it short-circuits real Route Handlers.
//   - Do NOT reach the real NestJS API — upstream is faked by mocks/ handlers.
//   - Per-scenario outcomes use reserved trigger fixtures in shared handlers
//     (e.g. "conflict@example.com" → 409); no per-test server.use() here.
export const test = base.extend<NetworkFixtures>({
  network: [async ({}, use) => { await use(); }, { auto: true }],
});

export { expect };
