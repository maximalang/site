import { describe, expect, it, vi } from "vitest";
import { PostgresMemoryCurationStore } from "./memory-curation-store.js";

const ids = {
  proposal: "memory_proposal_11111111-1111-1111-1111-111111111111",
  project: "project_33333333-3333-3333-3333-333333333333",
  source: "context_item_44444444-4444-4444-4444-444444444444",
} as const;
const proposedAt = "2026-08-15T00:00:00.000Z";

function proposal() {
  return {
    schemaVersion: 1,
    id: ids.proposal,
    projectId: ids.project,
    sourceContextItemId: ids.source,
    content: "Temporal evidence must be valid when proposed.",
    contentHash: "a".repeat(64),
    estimatedTokens: 8,
    importance: 0.8,
    status: "PENDING",
    createdAt: proposedAt,
  } as const;
}

function poolWithSource(source: { created_at: string; valid_until: string | null }) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("INSERT INTO agent_world.memory_proposals")) {
      expect(sql).toContain("source.created_at <= $9");
      expect(sql).toContain("source.valid_until IS NULL OR source.valid_until > $9");
      expect(params?.[8]).toBe(proposedAt);
      return { rows: [] };
    }
    if (sql.includes("FROM agent_world.memory_proposals")) return { rows: [] };
    if (sql.includes("FROM agent_world.context_items")) {
      return { rows: [{ id: ids.source, ...source }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query, pool: { connect: vi.fn(async () => ({ query, release: vi.fn() })) } };
}

describe("PostgresMemoryCurationStore proposal source validity", () => {
  it("rejects a source context that did not exist at proposal time", async () => {
    const { pool, query } = poolWithSource({
      created_at: "2026-08-15T00:00:00.001Z",
      valid_until: null,
    });

    await expect(
      new PostgresMemoryCurationStore(pool as never).propose(proposal()),
    ).rejects.toMatchObject({ name: "MemoryCurationStoreError", code: "SOURCE_NOT_ACTIVE" });
    expect(query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
  });

  it("rejects a source context whose validity ended at proposal time", async () => {
    const { pool, query } = poolWithSource({
      created_at: "2026-08-14T00:00:00.000Z",
      valid_until: proposedAt,
    });

    await expect(
      new PostgresMemoryCurationStore(pool as never).propose(proposal()),
    ).rejects.toMatchObject({ name: "MemoryCurationStoreError", code: "SOURCE_NOT_ACTIVE" });
    expect(query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
  });
});
