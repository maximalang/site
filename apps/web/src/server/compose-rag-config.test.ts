import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("../../../../", import.meta.url);

function readRepositoryFile(path: string): string {
  return readFileSync(new URL(path, repositoryRoot), "utf8");
}

describe("production Compose RAG configuration", () => {
  it("passes the canonical embedding route into web and documents both runtime modes", () => {
    const compose = readRepositoryFile("compose.yaml");
    const exampleEnvironment = readRepositoryFile(".env.example");

    expect(compose).toContain(
      "AGENT_WORLD_RAG_EMBEDDING_MODEL_ROUTE_ID: ${AGENT_WORLD_RAG_EMBEDDING_MODEL_ROUTE_ID:-}",
    );
    expect(exampleEnvironment).toContain(
      "AGENT_WORLD_RAG_EMBEDDING_MODEL_ROUTE_ID=model_route_00000000-0000-0000-0000-000000000000",
    );
    expect(exampleEnvironment).toContain("LITELLM_BASE_URL=http://127.0.0.1:4000");
    expect(exampleEnvironment).toContain("LITELLM_MASTER_KEY=replace-with-the-same-private-litellm-master-key");
  });
});
