import { createNativeChatAuthServer } from "./server.js";

const STARTUP_RETRIES = 30;
const STARTUP_DELAY_MS = 2000;

async function start() {
  let lastError;

  for (let attempt = 1; attempt <= STARTUP_RETRIES; attempt += 1) {
    try {
      const { server } = await createNativeChatAuthServer();
      server.listen(3002, "0.0.0.0", () => {
        console.info(
          JSON.stringify({
            ts: new Date().toISOString(),
            component: "native-chat-mcp-auth",
            event: "service_started",
            status: "ready",
          }),
        );
      });
      return;
    } catch (error) {
      lastError = error;
      const retryable =
        error?.code === "57P03" ||
        error?.message?.includes("database system is starting up");

      if (!retryable || attempt === STARTUP_RETRIES) {
        throw error;
      }

      console.info(
        JSON.stringify({
          ts: new Date().toISOString(),
          component: "native-chat-mcp-auth",
          event: "startup_retry",
          attempt,
          reason: "database_not_ready",
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, STARTUP_DELAY_MS));
    }
  }

  throw lastError;
}

await start();
