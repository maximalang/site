import { compileContextPack } from "@agent-world/conversation-service";
import { describe, expect, it, vi } from "vitest";
import { ContextPackStoreError, type PostgresContextPackStore } from "./context-pack-store.js";
import type { TransactionPool } from "./conversation-store.js";
import { PostgresRunContextPackProvider } from "./run-context-pack-provider.js";

vi.mock("@agent-world/conversation-service", () => ({
  compileContextPack: vi.fn(() => ({ schemaVersion: 1, id: "pack_test" })),
}));

const runId = "run_11111111-1111-1111-1111-111111111111";
const taskId = "task_11111111-1111-1111-1111-111111111111";
const agentId = "agent_22222222-2222-2222-2222-222222222222";
const projectId = "project_33333333-3333-3333-3333-333333333333";
const routeId = "route_44444444-4444-4444-4444-444444444444";
const chunkId = "document_chunk_55555555-5555-5555-5555-555555555555";
const contextId = "context_item_66666666-6666-6666-6666-666666666666";
const documentId = "document_77777777-7777-7777-7777-777777777777";
const compiledAt = "2026-08-19T13:00:00.000Z";

const scope = {
  run_id: runId,
  task_id: taskId,
  agent_id: agentId,
  project_id: projectId,
  task_title: "Find the semantic architecture decision",
  task_description: "Use relevant project evidence",
  task_idempotency_key: "task:semantic-rag",
  task_created_at: "2026-08-19T12:00:00.000Z",
  project_name: "AI World",
  agent_slug: "researcher",
  agent_display_name: "Researcher",
  agent_role: "Research",
  agent_instructions: "Verify evidence before acting.",
  agent_is_enabled: true,
  route_id: routeId,
  route_label: "Codex",
  route_mode: "CODEX",
  route_adapter_kind: "CODEX",
  route_account_id: null,
  route_is_enabled: true,
};

function fakePool(rows: unknown[][]) {
  const query = vi.fn();
  for (const result of rows) query.mockResolvedValueOnce({ rows: result });
  const releases: Array<ReturnType<typeof vi.fn>> = [];
  const connect = vi.fn(async () => {
    const release = vi.fn();
    releases.push(release);
    return { query, release };
  });
  return { query, releases, value: { connect } as unknown as TransactionPool };
}

function fakeStore() {
  return {
    readByRun: vi.fn(async () => {
      throw new ContextPackStoreError("NOT_FOUND");
    }),
    persist: vi.fn(async () => ({ outcome: "CREATED", contextPackId: "pack_test" })),
  } as unknown as PostgresContextPackStore;
}

describe("PostgresRunContextPackProvider semantic RAG", () => {
  it("adds a semantic RAG hit that lexical top-500 retrieval did not contain", async () => {
    const semanticContext = {
      id: contextId,
      project_id: projectId,
      kind: "RAG_CHUNK",
      temperature: "COLD",
      content: "PostgreSQL is the canonical state authority.",
      summary: null,
      content_sha256: "a".repeat(64),
      estimated_tokens: 12,
      importance: 0.7,
      provenance_kind: "DOCUMENT_CHUNK",
      event_id: null,
      message_id: null,
      run_id: null,
      artifact_id: null,
      document_chunk_id: chunkId,
      agent_id: null,
      task_id: null,
      skill_id: null,
      created_at: "2026-08-19T10:00:00.000Z",
      valid_until: null,
      relevance: 0,
    };
    const fake = fakePool([[scope], [], [], [], [semanticContext]]);
    const semanticRag = vi.fn(async () => [
      {
        chunkId,
        documentId,
        projectId,
        ordinal: 0,
        content: semanticContext.content,
        contentHash: semanticContext.content_sha256,
        estimatedTokens: semanticContext.estimated_tokens,
        embeddingModel: "embedding-v1",
        distance: 0.2,
        createdAt: semanticContext.created_at,
      } as never,
    ]);

    await new PostgresRunContextPackProvider(fake.value, {
      store: fakeStore(),
      packId: () => "context_pack_88888888-8888-8888-8888-888888888888",
      now: () => compiledAt,
      semanticRag,
    }).prepare(runId);

    expect(semanticRag).toHaveBeenCalledWith({
      projectId,
      query: "Find the semantic architecture decision Use relevant project evidence",
      maxItems: 50,
    });
    expect(fake.query).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("document_chunk_id = ANY($3::text[])"),
      [projectId, compiledAt, [chunkId]],
    );
    expect(vi.mocked(compileContextPack)).toHaveBeenCalledWith(
      expect.any(Object),
      [
        expect.objectContaining({
          item: expect.objectContaining({
            id: contextId,
            kind: "RAG_CHUNK",
            provenance: { kind: "DOCUMENT_CHUNK", documentChunkId: chunkId },
          }),
          relevance: 0.9,
        }),
      ],
      compiledAt,
    );
    expect(fake.releases).toHaveLength(2);
    expect(fake.releases.every((release) => release.mock.calls.length === 1)).toBe(true);
  });

  it("keeps lexical context compilation available when semantic retrieval fails", async () => {
    const lexicalContext = {
      id: contextId,
      project_id: projectId,
      kind: "FINDING",
      temperature: "WARM",
      content: "Lexical fallback evidence.",
      summary: null,
      content_sha256: "b".repeat(64),
      estimated_tokens: 8,
      importance: 0.6,
      provenance_kind: "RUN",
      event_id: null,
      message_id: null,
      run_id: runId,
      artifact_id: null,
      document_chunk_id: null,
      agent_id: null,
      task_id: null,
      skill_id: null,
      created_at: "2026-08-19T10:00:00.000Z",
      valid_until: null,
      relevance: 0.4,
    };
    const fake = fakePool([[scope], [], [lexicalContext], []]);
    const semanticRag = vi.fn(async () => {
      throw new Error("embedding gateway unavailable");
    });

    await new PostgresRunContextPackProvider(fake.value, {
      store: fakeStore(),
      packId: () => "context_pack_99999999-9999-9999-9999-999999999999",
      now: () => compiledAt,
      semanticRag,
    }).prepare(runId);

    expect(semanticRag).toHaveBeenCalledOnce();
    expect(vi.mocked(compileContextPack)).toHaveBeenCalledWith(
      expect.any(Object),
      [expect.objectContaining({ item: expect.objectContaining({ id: contextId }), relevance: 0.4 })],
      compiledAt,
    );
    expect(fake.query).toHaveBeenCalledTimes(4);
    expect(fake.releases).toHaveLength(1);
  });
});
