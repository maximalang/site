import { describe, expect, it, vi } from "vitest";
import { PostgresMemoryCurationStore } from "./memory-curation-store.js";

const ids = {
  proposal: "memory_proposal_11111111-1111-1111-1111-111111111111",
  decision: "memory_decision_22222222-2222-2222-2222-222222222222",
  project: "project_33333333-3333-3333-3333-333333333333",
  source: "context_item_44444444-4444-4444-4444-444444444444",
  memory: "context_item_55555555-5555-5555-5555-555555555555",
} as const;

const proposedAt = "2026-08-15T00:00:00.000Z";
const decidedAt = "2026-08-15T00:00:01.000Z";

function pendingProposal() {
  return {
    id: ids.proposal,
    project_id: ids.project,
    source_context_item_id: ids.source,
    content: "Only active canonical memory may satisfy curation.",
    content_sha256: "a".repeat(64),
    estimated_tokens: 8,
    importance: 0.9,
    status: "PENDING",
    created_at: proposedAt,
  };
}

describe("PostgresMemoryCurationStore active materialization", () => {
  it("does not accept an inactive canonical MEMORY fallback", async () => {
    const query = vi.fn(async (sql: string) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM agent_world.memory_curation_decisions")) return { rows: [] };
      if (sql.includes("FROM agent_world.memory_proposals") && sql.includes("FOR UPDATE")) {
        return { rows: [pendingProposal()] };
      }
      if (sql.includes("INSERT INTO agent_world.context_items")) {
        expect(sql).toContain("memory.created_at <= $3");
        expect(sql).toContain("memory.valid_until IS NULL OR memory.valid_until > $3");
        return { rows: [] };
      }
      throw new Error(`Unexpected query after inactive materialization: ${sql}`);
    });
    const pool = { connect: vi.fn(async () => ({ query, release: vi.fn() })) };

    await expect(
      new PostgresMemoryCurationStore(pool as never, {
        contextItemId: () => ids.memory,
      }).decide({
        schemaVersion: 1,
        id: ids.decision,
        proposalId: ids.proposal,
        projectId: ids.project,
        action: "ACCEPT",
        idempotencyKey: "memory:active-materialization-1",
        decidedAt,
      }),
    ).rejects.toMatchObject({ name: "MemoryCurationStoreError", code: "PROPOSAL_CONFLICT" });

    expect(query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO agent_world.memory_curation_decisions"),
      ),
    ).toBe(false);
  });
});
