import { describe, expect, it, vi } from "vitest";
import { createRagRouteHandler } from "./rag-http.js";

const input = {
  schemaVersion: 1,
  projectId: "project_11111111-1111-1111-1111-111111111111",
  title: "Architecture",
  mimeType: "text/markdown",
  content: "PostgreSQL is the canonical source of truth.",
  source: {
    kind: "UPLOAD",
    ref: "architecture.md",
    observedAt: "2026-08-17T12:00:00.000Z",
  },
};

describe("RAG HTTP", () => {
  it("authorizes and commits a validated ingestion request", async () => {
    const ingest = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      outcome: "CREATED",
      documentId: "document_22222222-2222-2222-2222-222222222222",
      chunkCount: 1,
      chunkIds: ["document_chunk_33333333-3333-3333-3333-333333333333"],
      contextItemIds: ["context_item_44444444-4444-4444-4444-444444444444"],
      embeddingModel: "rag-embedding-v1",
    });
    const response = await createRagRouteHandler({ authorize: async () => true, ingest })(
      new Request("https://agent-world.example/api/rag", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://agent-world.example" },
        body: JSON.stringify(input),
      }),
    );
    expect(response.status).toBe(201);
    expect(ingest).toHaveBeenCalledWith(input);
    expect(await response.json()).toMatchObject({ outcome: "CREATED", chunkCount: 1 });
  });

  it("fails closed before ingestion for unauthorized, cross-origin and oversized requests", async () => {
    const ingest = vi.fn();
    const handler = createRagRouteHandler({ authorize: async () => true, ingest });
    const unauthorized = await createRagRouteHandler({ authorize: async () => false, ingest })(
      new Request("https://agent-world.example/api/rag", { method: "POST" }),
    );
    const crossOrigin = await handler(
      new Request("https://agent-world.example/api/rag", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify(input),
      }),
    );
    const oversized = await handler(
      new Request("https://agent-world.example/api/rag", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://agent-world.example",
          "content-length": "6000000",
        },
        body: "{}",
      }),
    );
    expect([unauthorized.status, crossOrigin.status, oversized.status]).toEqual([401, 400, 413]);
    expect(ingest).not.toHaveBeenCalled();
  });
});
