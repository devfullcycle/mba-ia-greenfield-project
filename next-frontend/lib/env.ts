import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  // In Vitest, jsdom sets window = {} which tricks @t3-oss into thinking we're on
  // the client. Force server mode in test runs so server-only vars remain accessible
  // (MSW handlers, integration tests, session helpers all need API_URL/SESSION_PASSWORD).
  isServer: typeof window === "undefined" || process.env.VITEST !== undefined,

  server: {
    API_URL: z.url(),
    SESSION_PASSWORD: z.string().min(32, "SESSION_PASSWORD must be at least 32 characters"),
  },

  client: {},

  shared: {
    NODE_ENV: z.enum(["development", "production", "test"]),
  },

  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
  },

  emptyStringAsUndefined: true,
});
