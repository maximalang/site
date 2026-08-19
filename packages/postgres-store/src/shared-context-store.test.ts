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

  it("commits a document and all provenance-linked chunks in one transaction", async () => {
    const secondChunk = "document_chunk_55555555-5555-5555-5555-555555555555";
    const secondContext = "context_item_66666666-6666-6666-6666-666666666666";
    const { pool, query } = poolFor((sql, params) => {
      if (sql.includes("INSERT INTO agent_world.rag_documents"))
        return { rows: [{ id: ids.document, inserted: true }], rowCount: 1 };
      if (sql.includes("INSERT INTO agent_world.rag_document_sources"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO agent_world.rag_document_chunks"))
        return {
          rows: [{ id: params?.[3] === 0 ? ids.chunk : secondChunk, inserted: true }],
          rowCount: 1,
        };
      if (sql.includes("INSERT INTO agent_world.context_items"))
        return { rows: [{ id: params?.[0] }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const chunk = (id: string, contextItemId: string, ordinal: number) => ({
      schemaVersion: 1 as const,
      id,
      contextItemId,
      documentId: ids.document,
      projectId: ids.project,
      ordinal,
      content: `Canonical context evidence ${ordinal}.`,
      contentHash: String(ordinal + 1).repeat(64),
      estimatedTokens: 6,
      temperature: "COLD" as const,
      importance: 0.5,
      embeddingModel: "rag-embedding-v1",
      embedding,
      createdAt: now,
    });
    const receipt = await new PostgresSharedContextStore(pool as never).ingestDocumentWithChunks({
      document: {
        schemaVersion: 1,
        id: ids.document,
        projectId: ids.project,
        title: "Canonical architecture",
        contentHash: "a".repeat(64),
        mimeType: "text/markdown",
        byteSize: 100,
        source: { kind: "PROJECT_FILE", ref: "docs/architecture.md", observedAt: now },
        createdAt: now,
      },
      chunks: [chunk(ids.chunk, ids.context, 0), chunk(secondChunk, secondContext, 1)],
    });
    expect(receipt).toEqual({
      outcome: "CREATED",
      documentId: ids.document,
      chunkIds: [ids.chunk, secondChunk],
      contextItemIds: [ids.context, secondContext],
    });
    expect(query.mock.calls.filter(([sql]) => sql === "BEGIN")).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => sql === "COMMIT")).toHaveLength(1);
  });

  it("rejects model-less RAG retrieval before opening a database transaction", async () => {
    const connect = vi.fn();
    await expect(
      new PostgresSharedContextStore({ connect } as never).retrieve({
        schemaVersion: 1,
        projectId: ids.project,
        embedding,
        maxItems: 5,
      }),
    ).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });

  it("serializes validated vectors and filters retrieval by project and embedding model", async () => {
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
      embeddingModel: "text-embedding-3-small",
      embedding,
      maxItems: 5,
    });
    expect(result[0]).toMatchObject({
      chunkId: ids.chunk,
      projectId: ids.project,
      embeddingModel: "text-embedding-3-small",
      distance: 0.125,
    });
    const retrieval = query.mock.calls.find(([sql]) =>
      String(sql).includes("FROM agent_world.rag_document_chunks"),
    );
    expect(retrieval?.[0]).toContain("WHERE project_id = $1 AND embedding_model = $5");
    expect(retrieval?.[1]?.[0]).toBe(ids.project);
    expect(retrieval?.[1]?.[1]).toMatch(/^\[1,0,0,/);
    expect(retrieval?.[1]?.[4]).toBe("text-embedding-3-small");
  });
});
