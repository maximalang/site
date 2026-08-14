import { describe, expect, it } from "vitest";
import { MemoryCurationDecisionSchema, MemoryProposalSchema } from "./memory.js";

const ids = {
  proposal: "memory_proposal_11111111-1111-1111-1111-111111111111",
  decision: "memory_decision_22222222-2222-2222-2222-222222222222",
  project: "project_33333333-3333-3333-3333-333333333333",
  source: "context_item_44444444-4444-4444-4444-444444444444",
  target: "context_item_55555555-5555-5555-5555-555555555555",
} as const;
const now = "2026-08-15T00:00:00.000Z";

describe("memory curation contracts", () => {
  it("accepts a bounded provenance-linked proposal", () => {
    expect(
      MemoryProposalSchema.parse({
        schemaVersion: 1,
        id: ids.proposal,
        projectId: ids.project,
        sourceContextItemId: ids.source,
        content: "PostgreSQL owns canonical system memory.",
        contentHash: "a".repeat(64),
        estimatedTokens: 8,
        importance: 0.9,
        status: "PENDING",
        createdAt: now,
      }).status,
    ).toBe("PENDING");
  });

  it("requires a target only for merge and rejects unknown fields", () => {
    expect(() =>
      MemoryCurationDecisionSchema.parse({
        schemaVersion: 1,
        id: ids.decision,
        proposalId: ids.proposal,
        projectId: ids.project,
        action: "MERGE",
        idempotencyKey: "memory:merge-1",
        decidedAt: now,
      }),
    ).toThrow();
    expect(() =>
      MemoryCurationDecisionSchema.parse({
        schemaVersion: 1,
        id: ids.decision,
        proposalId: ids.proposal,
        projectId: ids.project,
        action: "ACCEPT",
        targetContextItemId: ids.target,
        idempotencyKey: "memory:accept-1",
        decidedAt: now,
        accountId: "account_66666666-6666-6666-6666-666666666666",
      }),
    ).toThrow();
    const merge = MemoryCurationDecisionSchema.parse({
      schemaVersion: 1,
      id: ids.decision,
      proposalId: ids.proposal,
      projectId: ids.project,
      action: "MERGE",
      targetContextItemId: ids.target,
      idempotencyKey: "memory:merge-1",
      decidedAt: now,
    });
    expect(merge.action).toBe("MERGE");
    if (merge.action !== "MERGE") throw new Error("Expected merge decision");
    expect(merge.targetContextItemId).toBe(ids.target);
  });
});
