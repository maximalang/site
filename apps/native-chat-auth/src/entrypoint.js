import { createNativeChatAuthServer } from "./server.js";

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
