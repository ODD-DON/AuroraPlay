import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
const chromium = process.env.PW_CHROMIUM_PATH ?? (process.env.CI ? undefined : "/opt/pw-browsers/chromium-1194/chrome-linux/chrome");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: chromium ? { executablePath: chromium } : {},
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } }],
  webServer: {
    // A fresh embedded database for every run. Test data is synthetic and labeled as such.
    command: `rm -rf .data/e2e && RR_PGLITE_DIR=.data/e2e RR_INPROCESS_WORKER=0 npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/onboarding`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
