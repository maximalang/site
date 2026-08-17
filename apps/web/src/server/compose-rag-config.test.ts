import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("../../../../", import.meta.url);

function readRepositoryFile(path: string): string {
  return readFileSync(new URL(path, repositoryRoot), "utf8");
}

function composeExpansion(name: string, fallback = ""): string {
  return `${name}: \${${name}:-${fallback}}`;
}

describe("production Compose optional runtime configuration", () => {
  it("passes optional runtime features through web and documents their owner configuration", () => {
    const compose = readRepositoryFile("compose.yaml");
    const exampleEnvironment = readRepositoryFile(".env.example");

    for (const { name, fallback } of [
      { name: "AGENT_WORLD_RAG_EMBEDDING_MODEL_ROUTE_ID", fallback: "" },
      { name: "AGENT_WORLD_LOCAL_MODEL_ORIGINS", fallback: "" },
      { name: "AGENT_WORLD_LANGFUSE_BASE_URL", fallback: "" },
      { name: "AGENT_WORLD_LANGFUSE_PUBLIC_KEY", fallback: "" },
      { name: "AGENT_WORLD_LANGFUSE_SECRET_KEY", fallback: "" },
      { name: "AGENT_WORLD_LANGFUSE_POLL_MS", fallback: "30000" },
      { name: "AGENT_WORLD_LANGFUSE_TIMEOUT_MS", fallback: "5000" },
      { name: "AGENT_WORLD_LANGFUSE_PLAINTEXT_ACK", fallback: "" },
      { name: "AGENT_WORLD_SCHEDULE_POLL_MS", fallback: "30000" },
      { name: "AGENT_WORLD_MISSION_HANDOFF_POLL_MS", fallback: "5000" },
      { name: "AGENT_WORLD_NATIVE_CHAT_LAUNCHER_ID", fallback: "" },
      { name: "AGENT_WORLD_NATIVE_CHAT_LAUNCHER_TOKEN_SHA256", fallback: "" },
    ]) {
      expect(compose).toContain(composeExpansion(name, fallback));
    }

    for (const documented of [
      "AGENT_WORLD_RAG_EMBEDDING_MODEL_ROUTE_ID=model_route_00000000-0000-0000-0000-000000000000",
      "AGENT_WORLD_LOCAL_MODEL_ORIGINS=http://ollama.internal:11434,http://lmstudio.internal:1234",
      "AGENT_WORLD_LANGFUSE_BASE_URL=https://langfuse.example.com",
      "AGENT_WORLD_SCHEDULE_POLL_MS=30000",
      "AGENT_WORLD_MISSION_HANDOFF_POLL_MS=5000",
      "LITELLM_BASE_URL=http://127.0.0.1:4000",
      "LITELLM_MASTER_KEY=replace-with-the-same-private-litellm-master-key",
      "AGENT_WORLD_NATIVE_CHAT_LAUNCHER_ID=launcher_00000000-0000-0000-0000-000000000000",
      "AGENT_WORLD_NATIVE_CHAT_LAUNCHER_TOKEN_SHA256=replace-with-64-lowercase-hex-characters",
      "AGENT_WORLD_NATIVE_CHAT_CONTROL_URL=https://agent-world.example.com/api/native-chat-launcher",
      "AGENT_WORLD_NATIVE_CHAT_LAUNCHER_TOKEN_FILE=C:/secure/agent-world-native-chat-launcher.token",
    ]) {
      expect(exampleEnvironment).toContain(documented);
    }
  });
});
