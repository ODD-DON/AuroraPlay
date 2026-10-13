import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
// Use a preinstalled Chromium when one is provided (cloud containers); otherwise Playwright's own browser.
const preinstalled = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const chromium = process.env.PW_CHROMIUM_PATH ?? (fs.existsSync(preinstalled) ? preinstalled : undefined);

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
    command: `node scripts/e2e-server.mjs ${PORT}`,
    url: `http://localhost:${PORT}/onboarding`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
