import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./regression-tests",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:3456",
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10000,
    navigationTimeout: 15000,
    launchOptions: {
      executablePath: "/app/generations/.cache/ms-playwright/chromium-1219/chrome-linux64/chrome",
    },
  },
});
