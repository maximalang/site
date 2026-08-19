import { describe, expect, it, vi } from "vitest";
import { PostgresMemoryCenterReader } from "./memory-center-reader.js";

const projectId = "project_11111111-1111-1111-1111-111111111111";
const now = "2026-08-15T00:00:00.000Z";

describe("PostgresMemoryCenterReader", () => {
  it("reads bounded project-scoped Inbox, Timeline and Network projections", async () => {
    const proposalId = "memory_proposal_22222222-2222-2222-2222-222222222222";
    const targetId = "context_item_66666666-6666-6666-6666-666666666666";
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      expect(params?.[0]).toBe(projectId);
      if (sql.includes("/* MEMORY_INBOX_CANDIDATES */")) {
        expect(params?.[1]).toEqual([proposalId]);
        expect(sql).toContain("item.content_sha256 = proposal.content_sha256");
        expect(sql).toContain("item.valid_until IS NULL OR item.valid_until > CURRENT_TIMESTAMP");
        expect(sql).toContain("LIMIT 5");
        return {
          rows: [
            {
              proposal_id: proposalId,
              context_item_id: targetId,
              content: "Candidate memory",
              importance: 1,
              created_at: now,
            },
          ],
        };
      }
      if (sql.includes("WHERE proposal.status = 'PENDING'"))
        return {
          rows: [
            {
              id: proposalId,
              project_id: projectId,
              source_context_item_id: "context_item_33333333-3333-3333-3333-333333333333",
              content: "Candidate memory",
              content_sha256: "a".repeat(64),
              estimated_tokens: 3,
              importance: 0.8,
              status: "PENDING",
              created_at: now,
            },
          ],
        };
      if (sql.includes("/* MEMORY_TIMELINE */"))
        return {
          rows: [
            {
              decision_id: "memory_decision_44444444-4444-4444-4444-444444444444",
              proposal_id: proposalId,
              action: "ACCEPT",
              source_context_item_id: "context_item_33333333-3333-3333-3333-333333333333",
              target_context_item_id: null,
              materialized_context_item_id: "context_item_55555555-5555-5555-5555-555555555555",
              content: "Candidate memory",
              decided_at: now,
            },
          ],
        };
      if (sql.includes("/* MEMORY_NETWORK_NODES */"))
        return {
          rows: [
            {
              context_item_id: "context_item_55555555-5555-5555-5555-555555555555",
              source_context_item_id: "context_item_33333333-3333-3333-3333-333333333333",
              content: "Candidate memory",
              importance: 0.8,
              created_at: now,
            },
          ],
        };
      if (sql.includes("/* MEMORY_NETWORK_EDGES */"))
        return {
          rows: [
            {
              decision_id: "memory_decision_44444444-4444-4444-4444-444444444444",
              source_context_item_id: "context_item_33333333-3333-3333-3333-333333333333",
              target_context_item_id: "context_item_55555555-5555-5555-5555-555555555555",
              relation: "ACCEPTED_FROM",
              created_at: now,
            },
          ],
        };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const reader = new PostgresMemoryCenterReader({ query } as never);
    const [inbox, timeline, network] = await Promise.all([
      reader.inbox(projectId, 50),
      reader.timeline(projectId, 50),
      reader.network(projectId, 50),
    ]);
    expect(inbox.proposals).toHaveLength(1);
    expect(inbox.proposals[0]?.curationCandidates).toEqual([
      expect.objectContaining({
        contextItemId: targetId,
        matchKind: "EXACT_CONTENT",
        suggestedAction: "MERGE",
      }),
    ]);
    expect(timeline.entries[0]?.action).toBe("ACCEPT");
    expect(network.nodes).toHaveLength(1);
    expect(network.edges[0]?.relation).toBe("ACCEPTED_FROM");
    expect(
      query.mock.calls
        .filter(([, params]) => typeof params?.[1] === "number")
        .every(([, params]) => Number(params?.[1]) <= 500),
    ).toBe(true);
  });

  it("does not query candidates when the bounded inbox is empty", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const inbox = await new PostgresMemoryCenterReader({ query } as never).inbox(projectId, 25);
    expect(inbox.proposals).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("projects replacement-to-target SUPERSEDES edges", async () => {
    const replacement = "context_item_77777777-7777-7777-7777-777777777777";
    const target = "context_item_88888888-8888-8888-8888-888888888888";
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("/* MEMORY_NETWORK_NODES */"))
        return {
          rows: [
            {
              context_item_id: replacement,
              source_context_item_id: "context_item_33333333-3333-3333-3333-333333333333",
              content: "Replacement memory",
              importance: 1,
              created_at: now,
            },
          ],
        };
      if (sql.includes("/* MEMORY_NETWORK_EDGES */"))
        return {
          rows: [
            {
              decision_id: "memory_decision_99999999-9999-9999-9999-999999999999",
              source_context_item_id: replacement,
              target_context_item_id: target,
              relation: "SUPERSEDES",
              created_at: now,
            },
          ],
        };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const network = await new PostgresMemoryCenterReader({ query } as never).network(projectId, 50);
    expect(network.edges).toEqual([
      expect.objectContaining({
        sourceContextItemId: replacement,
        targetContextItemId: target,
        relation: "SUPERSEDES",
      }),
    ]);
  });
});
