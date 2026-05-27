import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — drives a real browser against the Vite dev
 * server and a live backend. Designed to be invoked locally with the
 * docker-compose stack already running, or in CI where postgres +
 * backend run as service containers.
 *
 * Override the base URLs via env when running locally:
 *   E2E_BASE_URL=http://localhost:5173 \
 *   E2E_API_URL=http://localhost:8000 \
 *     npx playwright test
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  fullyParallel: true,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // In CI we start the preview server externally so multiple jobs can
  // share it; locally `npm run preview` is started for you.
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run preview -- --host 127.0.0.1 --port 4173",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
