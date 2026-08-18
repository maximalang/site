import { describe, expect, it, vi } from "vitest";
import { MemoryGraphProjector, PostgresMemoryProjectionStore } from "./memory-projection-store.js";

const event = {
  schemaVersion: 1 as const,
  sequence: 1,
  eventId: "event_11111111-1111-1111-1111-111111111111",
  eventType: "MEMORY_PROPOSED" as const,
  projectId: "project_22222222-2222-2222-2222-222222222222",
  proposalId: "memory_proposal_33333333-3333-3333-3333-333333333333",
  sourceContextItemId: "context_item_44444444-4444-4444-4444-444444444444",
  content: "Replayable canonical memory event.",
  occurredAt: "2026-08-15T00:00:00.000Z",
};

describe("memory graph projection", () => {
  it("maps canonical rows into bounded projection events", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({
      rows: [
        {
          sequence: 1,
          id: event.eventId,
          event_type: event.eventType,
          project_id: event.projectId,
          proposal_id: event.proposalId,
          decision_id: null,
          source_context_item_id: event.sourceContextItemId,
          target_context_item_id: null,
          materialized_context_item_id: null,
          action: null,
          content: event.content,
          occurred_at: event.occurredAt,
        },
      ],
    }));
    const events = await new PostgresMemoryProjectionStore({ query } as never).readEvents(0, 50);
    expect(events).toEqual([event]);
    expect(query.mock.calls[0]?.[1]).toEqual([0, 50]);
  });

  it("preserves explicit supersession target and replacement identities", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          sequence: 2,
          id: "event_55555555-5555-5555-5555-555555555555",
          event_type: "MEMORY_CURATED",
          project_id: event.projectId,
          proposal_id: event.proposalId,
          decision_id: "memory_decision_66666666-6666-6666-6666-666666666666",
          source_context_item_id: event.sourceContextItemId,
          target_context_item_id: "context_item_77777777-7777-7777-7777-777777777777",
          materialized_context_item_id: "context_item_88888888-8888-8888-8888-888888888888",
          action: "SUPERSEDE",
          content: "Replacement canonical memory.",
          occurred_at: "2026-08-15T00:02:00.000Z",
        },
      ],
    }));
    const [projected] = await new PostgresMemoryProjectionStore({ query } as never).readEvents(
      1,
      50,
    );
    expect(projected).toMatchObject({
      action: "SUPERSEDE",
      targetContextItemId: "context_item_77777777-7777-7777-7777-777777777777",
      materializedContextItemId: "context_item_88888888-8888-8888-8888-888888888888",
    });
  });

  it("advances a checkpoint only after the adapter applies the exact batch", async () => {
    const store = {
      readCheckpoint: vi.fn(async () => 0),
      readEvents: vi.fn(async () => [event]),
      advanceCheckpoint: vi.fn(async () => undefined),
    };
    const port = { apply: vi.fn(async () => ({ appliedThrough: 1 })) };
    const projected = await new MemoryGraphProjector(store as never, port, {
      projectionName: "graphiti",
      now: () => "2026-08-15T00:01:00.000Z",
    }).runBatch(100);
    expect(projected).toEqual({ applied: 1, appliedThrough: 1 });
    expect(store.advanceCheckpoint).toHaveBeenCalledWith(
      "graphiti",
      0,
      1,
      "2026-08-15T00:01:00.000Z",
    );
  });
});
