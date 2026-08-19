import { describe, expect, it, vi } from "vitest";
import { PostgresMemoryCurationStore } from "./memory-curation-store.js";

const ids = {
  proposal: "memory_proposal_11111111-1111-1111-1111-111111111111",
  duplicateProposal: "memory_proposal_66666666-6666-6666-6666-666666666666",
  decision: "memory_decision_22222222-2222-2222-2222-222222222222",
  project: "project_33333333-3333-3333-3333-333333333333",
  source: "context_item_44444444-4444-4444-4444-444444444444",
  memory: "context_item_55555555-5555-5555-5555-555555555555",
  replacement: "context_item_88888888-8888-8888-8888-888888888888",
  event: "event_77777777-7777-7777-7777-777777777777",
} as const;
const now = "2026-08-15T00:00:00.000Z";
const proposalContent = "PostgreSQL owns canonical memory.";
const proposalContentHash = "9a956031d2a8ea72e08a892298f00ac7292e47b8ce8deb3cfc435a34618d9956";

function poolFor(handler: (sql: string, params?: unknown[]) => { rows: unknown[] }) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    return handler(sql, params);
  });
  return { query, pool: { connect: vi.fn(async () => ({ query, release: vi.fn() })) } };
}

function pendingProposal() {
  return {
    id: ids.proposal,
    project_id: ids.project,
    source_context_item_id: ids.source,
    content: proposalContent,
    content_sha256: proposalContentHash,
    estimated_tokens: 7,
    importance: 0.9,
    status: "PENDING",
  };
}

describe("PostgresMemoryCurationStore", () => {
  it("rejects a proposal whose claimed content hash does not match canonical content", async () => {
    const connect = vi.fn();
    const store = new PostgresMemoryCurationStore({ connect } as never);
    await expect(
      store.propose({
        schemaVersion: 1,
        id: ids.proposal,
        projectId: ids.project,
        sourceContextItemId: ids.source,
        content: proposalContent,
        contentHash: "a".repeat(64),
        estimatedTokens: 7,
        importance: 0.9,
        status: "PENDING",
        createdAt: now,
      }),
    ).rejects.toMatchObject({ name: "MemoryCurationStoreError", code: "CONTENT_HASH_MISMATCH" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("creates a proposal only through same-project canonical provenance", async () => {
    const { pool, query } = poolFor((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("INSERT INTO agent_world.memory_proposals"))
        return { rows: [{ id: ids.proposal }] };
      if (sql.includes("INSERT INTO agent_world.memory_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const proposal = await new PostgresMemoryCurationStore(pool as never, {
      eventId: () => ids.event,
    }).propose({
      schemaVersion: 1,
      id: ids.proposal,
      projectId: ids.project,
      sourceContextItemId: ids.source,
      content: proposalContent,
      contentHash: proposalContentHash,
      estimatedTokens: 7,
      importance: 0.9,
      status: "PENDING",
      createdAt: now,
    });
    expect(proposal).toEqual({ outcome: "CREATED", proposalId: ids.proposal });
    expect(query.mock.calls.some(([sql]) => sql.includes("source.id = $3"))).toBe(true);
  });

  it("deduplicates the same candidate provenance under a different requested id", async () => {
    let requestHash = "";
    const { pool } = poolFor((sql, params) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("INSERT INTO agent_world.memory_proposals")) {
        requestHash = String(params?.[7]);
        return { rows: [] };
      }
      if (sql.includes("FROM agent_world.memory_proposals"))
        return {
          rows: [{ id: ids.proposal, request_sha256: requestHash }],
        };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const receipt = await new PostgresMemoryCurationStore(pool as never).propose({
      schemaVersion: 1,
      id: ids.duplicateProposal,
      projectId: ids.project,
      sourceContextItemId: ids.source,
      content: proposalContent,
      contentHash: proposalContentHash,
      estimatedTokens: 7,
      importance: 0.9,
      status: "PENDING",
      createdAt: now,
    });
    expect(receipt).toEqual({ outcome: "DEDUPLICATED", proposalId: ids.proposal });
  });

  it("accepts atomically by copying exact source provenance into MEMORY context", async () => {
    const { pool, query } = poolFor((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM agent_world.memory_curation_decisions")) return { rows: [] };
      if (sql.includes("FROM agent_world.memory_proposals") && sql.includes("FOR UPDATE"))
        return { rows: [pendingProposal()] };
      if (sql.includes("INSERT INTO agent_world.context_items"))
        return { rows: [{ id: ids.memory }] };
      if (sql.includes("INSERT INTO agent_world.memory_curation_decisions")) return { rows: [] };
      if (sql.includes("UPDATE agent_world.memory_proposals")) return { rows: [] };
      if (sql.includes("INSERT INTO agent_world.memory_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const result = await new PostgresMemoryCurationStore(pool as never, {
      contextItemId: () => ids.memory,
      eventId: () => ids.event,
    }).decide({
      schemaVersion: 1,
      id: ids.decision,
      proposalId: ids.proposal,
      projectId: ids.project,
      action: "ACCEPT",
      idempotencyKey: "memory:accept-1",
      decidedAt: now,
    });
    expect(result).toEqual({
      outcome: "CREATED",
      proposalId: ids.proposal,
      status: "ACCEPTED",
      materializedContextItemId: ids.memory,
    });
    expect(query.mock.calls.some(([sql]) => sql.includes("source.provenance_kind"))).toBe(true);
  });

  it("rejects MERGE when the target is neither exact content nor the same provenance", async () => {
    const { pool, query } = poolFor((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM agent_world.memory_curation_decisions")) return { rows: [] };
      if (sql.includes("FROM agent_world.memory_proposals") && sql.includes("FOR UPDATE"))
        return { rows: [pendingProposal()] };
      if (sql.includes("AS shares_source_provenance")) {
        return {
          rows: [
            {
              id: ids.memory,
              content: "A different active memory.",
              content_sha256: "b".repeat(64),
              shares_source_provenance: false,
              created_at: "2026-08-14T00:00:00.000Z",
              valid_until: null,
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const store = new PostgresMemoryCurationStore(pool as never);
    await expect(
      store.decide({
        schemaVersion: 1,
        id: ids.decision,
        proposalId: ids.proposal,
        projectId: ids.project,
        action: "MERGE",
        targetContextItemId: ids.memory,
        idempotencyKey: "memory:merge-mismatch-1",
        decidedAt: now,
      }),
    ).rejects.toMatchObject({ name: "MemoryCurationStoreError", code: "TARGET_RELATION_MISMATCH" });
    expect(query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("INSERT INTO agent_world.memory_curation_decisions"),
      ),
    ).toBe(false);
  });

  it("allows a human MERGE reformulation only when it shares canonical source provenance", async () => {
    const { pool, query } = poolFor((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM agent_world.memory_curation_decisions")) return { rows: [] };
      if (sql.includes("FROM agent_world.memory_proposals") && sql.includes("FOR UPDATE"))
        return { rows: [pendingProposal()] };
      if (sql.includes("AS shares_source_provenance")) {
        return {
          rows: [
            {
              id: ids.memory,
              content: "Existing wording from the same evidence.",
              content_sha256: "b".repeat(64),
              shares_source_provenance: true,
              created_at: "2026-08-14T00:00:00.000Z",
              valid_until: null,
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO agent_world.memory_curation_decisions")) return { rows: [] };
      if (sql.includes("UPDATE agent_world.memory_proposals")) return { rows: [] };
      if (sql.includes("INSERT INTO agent_world.memory_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const result = await new PostgresMemoryCurationStore(pool as never, {
      eventId: () => ids.event,
    }).decide({
      schemaVersion: 1,
      id: ids.decision,
      proposalId: ids.proposal,
      projectId: ids.project,
      action: "MERGE",
      targetContextItemId: ids.memory,
      idempotencyKey: "memory:merge-same-provenance-1",
      decidedAt: now,
    });
    expect(result).toEqual({
      outcome: "CREATED",
      proposalId: ids.proposal,
      status: "MERGED",
      materializedContextItemId: ids.memory,
    });
    expect(
      query.mock.calls.some(
        ([sql, params]) =>
          sql.includes("AS shares_source_provenance") &&
          JSON.stringify(params) === JSON.stringify([ids.memory, ids.project, ids.source]),
      ),
    ).toBe(true);
  });

  it("supersedes atomically by materializing replacement and expiring the active target", async () => {
    const { pool, query } = poolFor((sql, params) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM agent_world.memory_curation_decisions")) return { rows: [] };
      if (sql.includes("FROM agent_world.memory_proposals") && sql.includes("FOR UPDATE"))
        return { rows: [pendingProposal()] };
      if (sql.includes("SELECT id, created_at, valid_until"))
        return {
          rows: [{ id: ids.memory, created_at: "2026-08-14T00:00:00.000Z", valid_until: null }],
        };
      if (sql.includes("INSERT INTO agent_world.context_items"))
        return { rows: [{ id: ids.replacement }] };
      if (sql.includes("UPDATE agent_world.context_items")) {
        expect(params).toEqual([ids.memory, ids.project, now]);
        return { rows: [{ id: ids.memory }] };
      }
      if (sql.includes("INSERT INTO agent_world.memory_curation_decisions")) return { rows: [] };
      if (sql.includes("UPDATE agent_world.memory_proposals")) return { rows: [] };
      if (sql.includes("INSERT INTO agent_world.memory_events")) {
        expect(params?.[5]).toBe(ids.memory);
        expect(params?.[6]).toBe(ids.replacement);
        expect(params?.[7]).toBe("SUPERSEDE");
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const result = await new PostgresMemoryCurationStore(pool as never, {
      contextItemId: () => ids.replacement,
      eventId: () => ids.event,
    }).decide({
      schemaVersion: 1,
      id: ids.decision,
      proposalId: ids.proposal,
      projectId: ids.project,
      action: "SUPERSEDE",
      targetContextItemId: ids.memory,
      idempotencyKey: "memory:supersede-1",
      decidedAt: now,
    });
    expect(result).toEqual({
      outcome: "CREATED",
      proposalId: ids.proposal,
      status: "SUPERSEDED",
      materializedContextItemId: ids.replacement,
    });
    expect(query.mock.calls.some(([sql]) => sql.includes("SET valid_until = $3"))).toBe(true);
  });
});
