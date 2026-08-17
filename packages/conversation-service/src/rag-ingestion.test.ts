import { describe, expect, it, vi } from "vitest";
import { RagIngestionService, splitRagText } from "./rag-ingestion.js";

const ids = [
  "document_11111111-1111-1111-1111-111111111111",
  "document_chunk_22222222-2222-2222-2222-222222222222",
  "context_item_33333333-3333-3333-3333-333333333333",
  "document_chunk_44444444-4444-4444-4444-444444444444",
  "context_item_55555555-5555-5555-5555-555555555555",
];

describe("RAG ingestion", () => {
  it("splits normalized text deterministically with bounded overlap", () => {
    const text = `First paragraph.\r\n\r\n${"second ".repeat(12)}\r\n\r\nLast paragraph.`;
    const chunks = splitRagText(text, { maxCharacters: 64, overlapCharacters: 12 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 64 && chunk.trim() === chunk)).toBe(true);
    expect(splitRagText(text, { maxCharacters: 64, overlapCharacters: 12 })).toEqual(chunks);
    expect(chunks.join(" ")).toContain("First paragraph.");
    expect(chunks.join(" ")).toContain("Last paragraph.");
  });

  it("embeds all chunks before one atomic canonical write", async () => {
    let idIndex = 0;
    const embedding = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));
    const embed = vi
      .fn()
      .mockResolvedValue({ model: "rag-embedding-v1", vectors: [embedding, embedding] });
    const ingest = vi.fn().mockResolvedValue({
      outcome: "CREATED",
      documentId: ids[0],
      chunkIds: [ids[1], ids[3]],
      contextItemIds: [ids[2], ids[4]],
    });
    const service = new RagIngestionService({
      embeddingGateway: { embed },
      store: { ingestDocumentWithChunks: ingest },
      embeddingModelRouteId: "model_route_66666666-6666-6666-6666-666666666666",
      chunking: { maxCharacters: 48, overlapCharacters: 8 },
      now: () => new Date("2026-08-17T12:00:00.000Z"),
      nextId: () => ids[idIndex++] ?? "unexpected",
    });

    const receipt = await service.ingest({
      schemaVersion: 1,
      projectId: "project_77777777-7777-7777-7777-777777777777",
      title: "Architecture notes",
      mimeType: "text/markdown",
      content: `${"alpha ".repeat(7)}\n\n${"beta ".repeat(7)}`,
      source: {
        kind: "PROJECT_FILE",
        ref: "docs/architecture.md",
        observedAt: "2026-08-17T11:59:00.000Z",
      },
    });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(embed).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ingest).mock.invocationCallOrder[0] ?? 0,
    );
    expect(ingest.mock.calls[0]?.[0].chunks).toHaveLength(2);
    expect(ingest.mock.calls[0]?.[0].chunks[0]).toMatchObject({
      embeddingModel: "rag-embedding-v1",
      embedding,
      temperature: "COLD",
    });
    expect(receipt).toMatchObject({ outcome: "CREATED", chunkCount: 2 });
  });

  it("does not write a document when embedding fails", async () => {
    const ingest = vi.fn();
    const service = new RagIngestionService({
      embeddingGateway: { embed: vi.fn().mockRejectedValue(new Error("gateway unavailable")) },
      store: { ingestDocumentWithChunks: ingest },
      embeddingModelRouteId: "model_route_66666666-6666-6666-6666-666666666666",
    });
    await expect(
      service.ingest({
        schemaVersion: 1,
        projectId: "project_77777777-7777-7777-7777-777777777777",
        title: "Notes",
        mimeType: "text/plain",
        content: "Useful canonical knowledge.",
        source: {
          kind: "UPLOAD",
          ref: "notes.txt",
          observedAt: "2026-08-17T11:59:00.000Z",
        },
      }),
    ).rejects.toThrow("gateway unavailable");
    expect(ingest).not.toHaveBeenCalled();
  });

  it("batches large documents and preserves one embedding model", async () => {
    const embedding = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));
    const embed = vi.fn(async ({ texts }: { texts: string[] }) => ({
      model: "rag-embedding-v1",
      vectors: texts.map(() => embedding),
    }));
    const service = new RagIngestionService({
      embeddingGateway: { embed },
      store: {
        ingestDocumentWithChunks: async ({ document, chunks }) => ({
          outcome: "CREATED" as const,
          documentId: document.id,
          chunkIds: chunks.map((chunk) => chunk.id),
          contextItemIds: chunks.map((chunk) => chunk.contextItemId),
        }),
      },
      embeddingModelRouteId: "model_route_66666666-6666-6666-6666-666666666666",
      chunking: { maxCharacters: 32, overlapCharacters: 0 },
    });
    const receipt = await service.ingest({
      schemaVersion: 1,
      projectId: "project_77777777-7777-7777-7777-777777777777",
      title: "Large notes",
      mimeType: "text/plain",
      content: "bounded words ".repeat(220),
      source: {
        kind: "UPLOAD",
        ref: "large-notes.txt",
        observedAt: "2026-08-17T11:59:00.000Z",
      },
    });
    expect(embed.mock.calls.length).toBeGreaterThan(1);
    expect(embed.mock.calls.every(([request]) => request.texts.length <= 64)).toBe(true);
    expect(receipt.chunkCount).toBeGreaterThan(64);
  });
});
