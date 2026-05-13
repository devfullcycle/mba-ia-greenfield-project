import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  server: {
    API_URL: z.url(),
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
