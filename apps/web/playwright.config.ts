import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3210",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "compact-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 720 } },
    },
    {
      name: "tablet-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
    {
      name: "laptop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } },
    },
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "npm run dev --workspace @agent-world/web -- --hostname 127.0.0.1 --port 3210",
    env: { AGENT_WORLD_DATA_SOURCE: "contract-fixture" },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3210",
  },
});
