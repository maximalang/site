import { describe, expect, it } from "vitest";
import {
  MemoryCurationDecisionSchema,
  MemoryNetworkSchema,
  MemoryProjectionEventSchema,
  MemoryProposalSchema,
  MemoryTimelineSchema,
} from "./memory.js";

const ids = {
  proposal: "memory_proposal_11111111-1111-1111-1111-111111111111",
  decision: "memory_decision_22222222-2222-2222-2222-222222222222",
  project: "project_33333333-3333-3333-3333-333333333333",
  source: "context_item_44444444-4444-4444-4444-444444444444",
  target: "context_item_55555555-5555-5555-5555-555555555555",
  replacement: "context_item_77777777-7777-7777-7777-777777777777",
  event: "event_66666666-6666-6666-6666-666666666666",
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

  it("defines bounded replay and Memory Center projection contracts", () => {
    expect(
      MemoryProjectionEventSchema.parse({
        schemaVersion: 1,
        sequence: 1,
        eventId: ids.event,
        eventType: "MEMORY_CURATED",
        projectId: ids.project,
        proposalId: ids.proposal,
        decisionId: ids.decision,
        action: "MERGE",
        sourceContextItemId: ids.source,
        targetContextItemId: ids.target,
        materializedContextItemId: ids.target,
        content: "Canonical memory.",
        occurredAt: now,
      }).action,
    ).toBe("MERGE");
    expect(
      MemoryTimelineSchema.parse({ schemaVersion: 1, projectId: ids.project, entries: [] }),
    ).toEqual({ schemaVersion: 1, projectId: ids.project, entries: [] });
    expect(
      MemoryNetworkSchema.parse({
        schemaVersion: 1,
        projectId: ids.project,
        nodes: [],
        edges: [],
      }),
    ).toMatchObject({ projectId: ids.project, nodes: [], edges: [] });
  });

  it("requires targets for merge and supersede and preserves supersession targets", () => {
    for (const action of ["MERGE", "SUPERSEDE"] as const) {
      expect(() =>
        MemoryCurationDecisionSchema.parse({
          schemaVersion: 1,
          id: ids.decision,
          proposalId: ids.proposal,
          projectId: ids.project,
          action,
          idempotencyKey: `memory:${action.toLowerCase()}-1`,
          decidedAt: now,
        }),
      ).toThrow();
    }
    const supersede = MemoryCurationDecisionSchema.parse({
      schemaVersion: 1,
      id: ids.decision,
      proposalId: ids.proposal,
      projectId: ids.project,
      action: "SUPERSEDE",
      targetContextItemId: ids.target,
      idempotencyKey: "memory:supersede-1",
      decidedAt: now,
    });
    expect(supersede.action).toBe("SUPERSEDE");
    if (supersede.action !== "SUPERSEDE") throw new Error("Expected supersede decision");
    expect(supersede.targetContextItemId).toBe(ids.target);

    const projected = MemoryProjectionEventSchema.parse({
      schemaVersion: 1,
      sequence: 2,
      eventId: ids.event,
      eventType: "MEMORY_CURATED",
      projectId: ids.project,
      proposalId: ids.proposal,
      decisionId: ids.decision,
      action: "SUPERSEDE",
      sourceContextItemId: ids.source,
      targetContextItemId: ids.target,
      materializedContextItemId: ids.replacement,
      content: "Replacement canonical memory.",
      occurredAt: now,
    });
    expect(projected.targetContextItemId).toBe(ids.target);
  });

  it("rejects self-supersession and unknown fields", () => {
    expect(() =>
      MemoryProjectionEventSchema.parse({
        schemaVersion: 1,
        sequence: 2,
        eventId: ids.event,
        eventType: "MEMORY_CURATED",
        projectId: ids.project,
        proposalId: ids.proposal,
        decisionId: ids.decision,
        action: "SUPERSEDE",
        sourceContextItemId: ids.source,
        targetContextItemId: ids.target,
        materializedContextItemId: ids.target,
        content: "Invalid self replacement.",
        occurredAt: now,
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
  });
});
