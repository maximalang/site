import { describe, expect, it, vi } from "vitest";
import { MemoryCurationStoreError, PostgresMemoryCurationStore } from "./memory-curation-store.js";

const ids = {
  proposal: "memory_proposal_11111111-1111-1111-1111-111111111111",
  decision: "memory_decision_22222222-2222-2222-2222-222222222222",
  project: "project_33333333-3333-3333-3333-333333333333",
  source: "context_item_44444444-4444-4444-4444-444444444444",
  target: "context_item_55555555-5555-5555-5555-555555555555",
} as const;

function pendingProposal() {
  return {
    id: ids.proposal,
    project_id: ids.project,
    source_context_item_id: ids.source,
    content: "Canonical memory candidate.",
    content_sha256: "a".repeat(64),
    estimated_tokens: 4,
    importance: 0.8,
    status: "PENDING",
  };
}

function poolWithTarget(target: { created_at: string; valid_until: string | null }) {
  const query = vi.fn(async (sql: string) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FROM agent_world.memory_curation_decisions")) return { rows: [] };
    if (sql.includes("FROM agent_world.memory_proposals") && sql.includes("FOR UPDATE")) {
      return { rows: [pendingProposal()] };
    }
    if (sql.includes("SELECT id, created_at, valid_until")) {
      return { rows: [{ id: ids.target, ...target }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { connect: vi.fn(async () => ({ query, release: vi.fn() })) };
}

async function mergeWithTarget(target: { created_at: string; valid_until: string | null }) {
  return new PostgresMemoryCurationStore(poolWithTarget(target) as never).decide({
    schemaVersion: 1,
    id: ids.decision,
    proposalId: ids.proposal,
    projectId: ids.project,
    action: "MERGE",
    targetContextItemId: ids.target,
    idempotencyKey: "memory:merge-active-target",
    decidedAt: "2026-08-15T00:00:00.000Z",
  });
}

describe("memory merge target validity", () => {
  it("rejects an already expired MEMORY target", async () => {
    await expect(
      mergeWithTarget({
        created_at: "2026-08-13T00:00:00.000Z",
        valid_until: "2026-08-14T00:00:00.000Z",
      }),
    ).rejects.toEqual(new MemoryCurationStoreError("TARGET_NOT_ACTIVE"));
  });

  it("rejects a MEMORY target that did not yet exist at decision time", async () => {
    await expect(
      mergeWithTarget({
        created_at: "2026-08-16T00:00:00.000Z",
        valid_until: null,
      }),
    ).rejects.toEqual(new MemoryCurationStoreError("TARGET_NOT_ACTIVE"));
  });
});
