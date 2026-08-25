import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom ships no ResizeObserver; Radix UI primitives (@radix-ui/react-use-size,
// used by Checkbox and others) reference it at mount.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Env vars required by lib/env.ts at module load in test runtime.
// Must be set before any module importing lib/env.ts is evaluated.
process.env.API_URL = process.env.API_URL ?? "http://nestjs-api:3000";
process.env.SESSION_PASSWORD =
  process.env.SESSION_PASSWORD ?? "test-session-secret-that-is-at-least-32ch";
