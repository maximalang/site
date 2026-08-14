import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@agent-world/codex-adapter": fileURLToPath(
        new URL("./packages/codex-adapter/src/index.ts", import.meta.url),
      ),
      "@agent-world/conversation-service": fileURLToPath(
        new URL("./packages/conversation-service/src/index.ts", import.meta.url),
      ),
      "@agent-world/domain": fileURLToPath(
        new URL("./packages/domain/src/index.ts", import.meta.url),
      ),
      "@agent-world/model-gateway": fileURLToPath(
        new URL("./packages/model-gateway/src/index.ts", import.meta.url),
      ),
      "@agent-world/openclaw-adapter": fileURLToPath(
        new URL("./packages/openclaw-adapter/src/index.ts", import.meta.url),
      ),
      "@agent-world/orchestration": fileURLToPath(
        new URL("./packages/orchestration/src/index.ts", import.meta.url),
      ),
      "@agent-world/postgres-store": fileURLToPath(
        new URL("./packages/postgres-store/src/index.ts", import.meta.url),
      ),
      "@agent-world/read-model": fileURLToPath(
        new URL("./packages/read-model/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["packages/**/*.test.ts", "apps/**/*.test.{ts,tsx}"],
    passWithNoTests: false,
  },
});
