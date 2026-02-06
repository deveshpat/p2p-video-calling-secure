import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  webServer: [
    {
      command: "PORT=8866 npm run backend:dev",
      port: 8866,
      timeout: 120_000,
      reuseExistingServer: true,
    },
    {
      command: "VITE_API_BASE_URL=http://127.0.0.1:8866 npm run dev -- --host 127.0.0.1 --port 4173",
      port: 4173,
      timeout: 120_000,
      reuseExistingServer: true,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
