import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
      // server-only throws outside Next.js runtime; stub it in Vitest.
      "server-only": resolve(import.meta.dirname, "./lib/__mocks__/server-only"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts", "./mocks/setup.ts"],
    passWithNoTests: true,
  },
});
