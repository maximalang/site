import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("../../../../", import.meta.url);

function readRepositoryFile(path: string): string {
  return readFileSync(new URL(path, repositoryRoot), "utf8");
}

describe("production Compose optional runtime configuration", () => {
  it("passes optional runtime features through web and documents their owner configuration", () => {
    const compose = readRepositoryFile("compose.yaml");
    const exampleEnvironment = readRepositoryFile(".env.example");

    for (const mapping of [
      "AGENT_WORLD_RAG_EMBEDDING_MODEL_ROUTE_ID: ${AGENT_WORLD_RAG_EMBEDDING_MODEL_ROUTE_ID:-}",
      "AGENT_WORLD_LOCAL_MODEL_ORIGINS: ${AGENT_WORLD_LOCAL_MODEL_ORIGINS:-}",
      "AGENT_WORLD_LANGFUSE_BASE_URL: ${AGENT_WORLD_LANGFUSE_BASE_URL:-}",
      "AGENT_WORLD_LANGFUSE_PUBLIC_KEY: ${AGENT_WORLD_LANGFUSE_PUBLIC_KEY:-}",
      "AGENT_WORLD_LANGFUSE_SECRET_KEY: ${AGENT_WORLD_LANGFUSE_SECRET_KEY:-}",
      "AGENT_WORLD_LANGFUSE_POLL_MS: ${AGENT_WORLD_LANGFUSE_POLL_MS:-30000}",
      "AGENT_WORLD_LANGFUSE_TIMEOUT_MS: ${AGENT_WORLD_LANGFUSE_TIMEOUT_MS:-5000}",
      "AGENT_WORLD_LANGFUSE_PLAINTEXT_ACK: ${AGENT_WORLD_LANGFUSE_PLAINTEXT_ACK:-}",
      "AGENT_WORLD_SCHEDULE_POLL_MS: ${AGENT_WORLD_SCHEDULE_POLL_MS:-30000}",
    ]) {
      expect(compose).toContain(mapping);
    }

    for (const documented of [
      "AGENT_WORLD_RAG_EMBEDDING_MODEL_ROUTE_ID=model_route_00000000-0000-0000-0000-000000000000",
      "AGENT_WORLD_LOCAL_MODEL_ORIGINS=http://ollama.internal:11434,http://lmstudio.internal:1234",
      "AGENT_WORLD_LANGFUSE_BASE_URL=https://langfuse.example.com",
      "AGENT_WORLD_SCHEDULE_POLL_MS=30000",
      "LITELLM_BASE_URL=http://127.0.0.1:4000",
      "LITELLM_MASTER_KEY=replace-with-the-same-private-litellm-master-key",
    ]) {
      expect(exampleEnvironment).toContain(documented);
    }
  });
});
