import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;
const RULES_OVERRIDE = JSON.stringify({
  timers: { resultMs: 800, pickMs: 30_000, hintMs: 30_000, guessMs: 30_000 },
});

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // A full quick game waits through every result timer; 30 s is too tight.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    actionTimeout: 15_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "npm run build && " +
      `SCORER=fake PORT=${PORT} DATABASE_PATH=:memory: HW_RULES_OVERRIDE='${RULES_OVERRIDE}' ` +
      "npx tsx apps/server/src/index.ts",
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
