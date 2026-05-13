import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./mocks/setup.ts"],
    passWithNoTests: true,
  },
});
