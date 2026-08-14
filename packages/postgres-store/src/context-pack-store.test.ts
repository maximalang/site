import { describe, expect, it, vi } from "vitest";
import { ContextPackStoreError, PostgresContextPackStore } from "./context-pack-store.js";

const pack = {
  schemaVersion: 1,
  compilerVersion: "1.0.0",
  id: "context_pack_11111111-1111-1111-1111-111111111111",
  runId: "run_22222222-2222-2222-2222-222222222222",
  taskId: "task_33333333-3333-3333-3333-333333333333",
  agentId: "agent_44444444-4444-4444-4444-444444444444",
  projectId: "project_55555555-5555-5555-5555-555555555555",
  routeId: "route_66666666-6666-6666-6666-666666666666",
  tokenBudget: 1_000,
  estimatedTokens: 100,
  contentHash: "a".repeat(64),
  compiledAt: "2026-08-14T21:00:00.000Z",
  sections: [
    "GOAL",
    "CURRENT_PROJECT_STATE",
    "RELEVANT_DECISIONS",
    "RELEVANT_MEMORY",
    "RELEVANT_FINDINGS",
    "REQUIRED_SKILLS",
    "AVAILABLE_TOOLS",
    "ARTIFACT_REFERENCES",
    "EXPECTED_OUTPUT",
    "HANDOFF_CONTRACT",
  ].map((name) => ({ name, content: `${name} content` })),
  rendered: "Rendered exact ContextPack",
  evidence: [
    {
      contextItemId: "context_item_77777777-7777-7777-7777-777777777777",
      section: "RELEVANT_MEMORY",
      contentHash: "b".repeat(64),
      score: 305,
      provenance: { kind: "RUN", runId: "run_22222222-2222-2222-2222-222222222222" },
    },
  ],
} as const;

function harness(existingHash?: string) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
    if (sql.includes("SELECT id, pack_sha256"))
      return existingHash
        ? { rows: [{ id: pack.id, pack_sha256: existingHash }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    if (sql.includes("INSERT INTO agent_world.context_packs")) return { rows: [], rowCount: 1 };
    if (sql.includes("INSERT INTO agent_world.context_pack_evidence"))
      return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const client = { query, release: vi.fn() };
  return {
    query,
    store: new PostgresContextPackStore({ connect: vi.fn(async () => client) } as never),
  };
}

describe("PostgresContextPackStore", () => {
  it("persists one exact pack and its ordered evidence atomically", async () => {
    const { store, query } = harness();
    expect(await store.persist(pack)).toEqual({ outcome: "CREATED", contextPackId: pack.id });
    const packInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO agent_world.context_packs"),
    );
    expect(packInsert?.[1]).toEqual(
      expect.arrayContaining([pack.id, pack.runId, pack.contentHash]),
    );
    const evidenceInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO agent_world.context_pack_evidence"),
    );
    expect(evidenceInsert?.[1]).toEqual(
      expect.arrayContaining([pack.id, 0, pack.evidence[0].contextItemId]),
    );
  });

  it("replays an exact persisted pack and rejects a changed pack for the same Run", async () => {
    const fingerprint = PostgresContextPackStore.fingerprint(pack);
    expect(await harness(fingerprint).store.persist(pack)).toEqual({
      outcome: "REPLAY",
      contextPackId: pack.id,
    });
    await expect(harness("f".repeat(64)).store.persist(pack)).rejects.toEqual(
      new ContextPackStoreError("IDEMPOTENCY_CONFLICT"),
    );
  });

  it("recovers the exact persisted pack without recompiling current context", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM agent_world.context_packs"))
        return {
          rows: [
            {
              id: pack.id,
              run_id: pack.runId,
              task_id: pack.taskId,
              agent_id: pack.agentId,
              project_id: pack.projectId,
              route_id: pack.routeId,
              compiler_version: pack.compilerVersion,
              token_budget: pack.tokenBudget,
              estimated_tokens: pack.estimatedTokens,
              content_sha256: pack.contentHash,
              sections: pack.sections,
              rendered: pack.rendered,
              compiled_at: pack.compiledAt,
            },
          ],
          rowCount: 1,
        };
      if (sql.includes("FROM agent_world.context_pack_evidence"))
        return {
          rows: [
            {
              context_item_id: pack.evidence[0].contextItemId,
              section: pack.evidence[0].section,
              content_sha256: pack.evidence[0].contentHash,
              score: pack.evidence[0].score,
              provenance: pack.evidence[0].provenance,
            },
          ],
          rowCount: 1,
        };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const store = new PostgresContextPackStore({
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as never);
    expect(await store.readByRun(pack.runId)).toEqual(pack);
  });
});
