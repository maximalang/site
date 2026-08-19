import { defineConfig, devices } from "@playwright/test";

const browserChannel =
  process.env.AGENT_WORLD_PLAYWRIGHT_CHANNEL === "chrome" ? "chrome" : undefined;

export default defineConfig({
  testDir: "./tests-production",
  fullyParallel: false,
  forbidOnly: true,
  outputDir: "./test-results/production",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3211",
    trace: "retain-on-failure",
    ...(browserChannel ? { channel: browserChannel } : {}),
  },
  projects: [
    {
      name: "production-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    env: {
      AGENT_WORLD_DATA_SOURCE: "contract-fixture",
      HOSTNAME: "127.0.0.1",
      PORT: "3211",
    },
    reuseExistingServer: false,
    timeout: 180_000,
    url: "http://127.0.0.1:3211",
  },
});
