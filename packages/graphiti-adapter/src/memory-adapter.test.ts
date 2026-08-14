import { MemoryProjectionEventSchema } from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import { GraphitiMemoryAdapter } from "./memory-adapter.js";

const base = {
  schemaVersion: 1 as const,
  projectId: "project_11111111-1111-1111-1111-111111111111",
  proposalId: "memory_proposal_22222222-2222-2222-2222-222222222222",
  sourceContextItemId: "context_item_33333333-3333-3333-3333-333333333333",
  content: "PostgreSQL remains canonical.",
  occurredAt: "2026-08-15T00:00:00.000Z",
};

describe("GraphitiMemoryAdapter", () => {
  it("projects only accepted memory with deterministic provenance", async () => {
    const call = vi.fn(async () => ({ isError: false }));
    const transport = {
      listTools: vi.fn(async () => [
        {
          name: "add_memory",
          inputSchema: {
            properties: {
              name: {},
              episode_body: {},
              group_id: {},
              source: {},
              source_description: {},
              reference_time: {},
              uuid: {},
              update_communities: {},
            },
          },
        },
      ]),
      call,
    };
    const events = [
      {
        ...base,
        sequence: 1,
        eventId: "event_44444444-4444-4444-4444-444444444444",
        eventType: "MEMORY_PROPOSED",
      },
      {
        ...base,
        sequence: 2,
        eventId: "event_55555555-5555-5555-5555-555555555555",
        eventType: "MEMORY_CURATED",
        decisionId: "memory_decision_66666666-6666-6666-6666-666666666666",
        action: "ACCEPT",
        materializedContextItemId: "context_item_77777777-7777-7777-7777-777777777777",
      },
      {
        ...base,
        sequence: 3,
        eventId: "event_88888888-8888-8888-8888-888888888888",
        eventType: "MEMORY_CURATED",
        decisionId: "memory_decision_99999999-9999-9999-9999-999999999999",
        action: "REJECT",
      },
    ].map((value) => MemoryProjectionEventSchema.parse(value));
    const receipt = await new GraphitiMemoryAdapter(transport).apply(events);
    expect(receipt).toEqual({ appliedThrough: 3 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("add_memory", {
      name: "AI World memory memory_proposal_22222222-2222-2222-2222-222222222222",
      episode_body: expect.stringContaining("event_55555555-5555-5555-5555-555555555555"),
      group_id: base.projectId,
      source: "json",
      source_description: "AI World canonical curated memory projection",
      reference_time: base.occurredAt,
      uuid: "55555555-5555-5555-5555-555555555555",
      update_communities: false,
    });
  });

  it("fails readiness when an outdated MCP omits temporal or idempotency fields", async () => {
    const adapter = new GraphitiMemoryAdapter({
      listTools: async () => [
        { name: "add_memory", inputSchema: { properties: { episode_body: {}, group_id: {} } } },
      ],
      call: async () => ({ isError: false }),
    });
    await expect(adapter.apply([])).rejects.toThrow("GRAPHITI_ADD_MEMORY_SCHEMA_DRIFT");
  });
});
