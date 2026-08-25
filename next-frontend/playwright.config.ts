import { defineConfig, devices } from "@playwright/test";

// The dev server runs inside Docker (containerized next dev with MSW_ENABLED=true).
// Playwright runs on the HOST — never add a webServer block here.
// Start the server manually: docker compose exec -d next-frontend sh -c "MSW_ENABLED=true npm run dev"
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e-spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
