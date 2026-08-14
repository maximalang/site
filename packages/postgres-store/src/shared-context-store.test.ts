import { describe, expect, it, vi } from "vitest";
import { PostgresSharedContextStore } from "./shared-context-store.js";

const ids = {
  project: "project_11111111-1111-1111-1111-111111111111",
  document: "document_22222222-2222-2222-2222-222222222222",
  chunk: "document_chunk_33333333-3333-3333-3333-333333333333",
  context: "context_item_44444444-4444-4444-4444-444444444444",
} as const;
const now = "2026-08-14T20:00:00.000Z";
const embedding = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));

function poolFor(
  handler: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount: number },
) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
    return handler(sql, params);
  });
  return { query, pool: { connect: vi.fn(async () => ({ query, release: vi.fn() })) } };
}

describe("PostgresSharedContextStore", () => {
  it("writes a canonical document and source with parameters", async () => {
    const { pool, query } = poolFor((sql) => {
      if (sql.includes("INSERT INTO agent_world.rag_documents"))
        return { rows: [{ id: ids.document, inserted: true }], rowCount: 1 };
      if (sql.includes("INSERT INTO agent_world.rag_document_sources"))
        return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const result = await new PostgresSharedContextStore(pool as never).ingestDocument({
      schemaVersion: 1,
      id: ids.document,
      projectId: ids.project,
      title: "Canonical architecture",
      contentHash: "a".repeat(64),
      mimeType: "text/markdown",
      byteSize: 100,
      source: { kind: "PROJECT_FILE", ref: "docs/architecture.md", observedAt: now },
      createdAt: now,
    });
    expect(result).toEqual({ outcome: "CREATED", documentId: ids.document });
    expect(
      query.mock.calls.every(([, params]) => params === undefined || Array.isArray(params)),
    ).toBe(true);
  });

  it("returns the canonical id for duplicate document content", async () => {
    const { pool } = poolFor((sql) => {
      if (sql.includes("INSERT INTO agent_world.rag_documents")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM agent_world.rag_documents"))
        return { rows: [{ id: ids.document, inserted: false }], rowCount: 1 };
      if (sql.includes("INSERT INTO agent_world.rag_document_sources"))
        return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const result = await new PostgresSharedContextStore(pool as never).ingestDocument({
      schemaVersion: 1,
      id: "document_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      projectId: ids.project,
      title: "Duplicate",
      contentHash: "a".repeat(64),
      mimeType: "text/plain",
      byteSize: 100,
      source: { kind: "UPLOAD", ref: "architecture.txt", observedAt: now },
      createdAt: now,
    });
    expect(result).toEqual({ outcome: "DEDUPLICATED", documentId: ids.document });
  });

  it("materializes every canonical RAG chunk as provenance-linked shared context", async () => {
    const { pool } = poolFor((sql) => {
      if (sql.includes("INSERT INTO agent_world.rag_document_chunks"))
        return { rows: [{ id: ids.chunk, inserted: true }], rowCount: 1 };
      if (sql.includes("INSERT INTO agent_world.context_items"))
        return { rows: [{ id: ids.context }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const receipt = await new PostgresSharedContextStore(pool as never).writeChunk({
      schemaVersion: 1,
      id: ids.chunk,
      contextItemId: ids.context,
      documentId: ids.document,
      projectId: ids.project,
      ordinal: 0,
      content: "Canonical context evidence.",
      contentHash: "b".repeat(64),
      estimatedTokens: 6,
      temperature: "WARM",
      importance: 0.9,
      embeddingModel: "text-embedding-3-small",
      embedding,
      createdAt: now,
    });
    expect(receipt).toEqual({
      outcome: "CREATED",
      chunkId: ids.chunk,
      contextItemId: ids.context,
    });
  });

  it("serializes validated vectors as a parameter and filters retrieval by project", async () => {
    const { pool, query } = poolFor((sql) => {
      if (sql.startsWith("SET LOCAL")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM agent_world.rag_document_chunks"))
        return {
          rows: [
            {
              id: ids.chunk,
              document_id: ids.document,
              project_id: ids.project,
              ordinal: 0,
              content: "Canonical state",
              content_sha256: "b".repeat(64),
              estimated_tokens: 4,
              embedding_model: "text-embedding-3-small",
              distance: 0.125,
              created_at: now,
            },
          ],
          rowCount: 1,
        };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const result = await new PostgresSharedContextStore(pool as never).retrieve({
      schemaVersion: 1,
      projectId: ids.project,
      embedding,
      maxItems: 5,
    });
    expect(result[0]).toMatchObject({
      chunkId: ids.chunk,
      projectId: ids.project,
      distance: 0.125,
    });
    const retrieval = query.mock.calls.find(([sql]) =>
      String(sql).includes("FROM agent_world.rag_document_chunks"),
    );
    expect(retrieval?.[0]).toContain("WHERE project_id = $1");
    expect(retrieval?.[1]?.[0]).toBe(ids.project);
    expect(retrieval?.[1]?.[1]).toMatch(/^\[1,0,0,/);
  });
});
