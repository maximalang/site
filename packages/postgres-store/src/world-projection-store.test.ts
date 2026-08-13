import { AgentSchema, BindingIdSchema } from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import { PostgresWorldProjectionStore } from "./world-projection-store.js";

const agent = AgentSchema.parse({
  schemaVersion: 1,
  id: "agent_11111111-1111-1111-1111-111111111111",
  slug: "researcher",
  displayName: "Researcher",
  role: "Research",
  instructions: "Verify claims.",
  isEnabled: true,
});
const bindingId = BindingIdSchema.parse("binding_22222222-2222-2222-2222-222222222222");

function pool(rows: unknown[][]) {
  const query = vi.fn();
  for (const result of rows) query.mockResolvedValueOnce({ rows: result });
  const release = vi.fn();
  return {
    query,
    release,
    value: { connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionPool,
  };
}

describe("PostgresWorldProjectionStore", () => {
  it("appends one monotonic event and projection update for a changed runtime status", async () => {
    const fake = pool([[], [], [], [{ last_sequence: "7" }], [], [], []]);
    const store = new PostgresWorldProjectionStore(fake.value, {
      eventId: () => "event_33333333-3333-3333-3333-333333333333",
    });
    await store.applyOpenClawSnapshot({
      observedAt: "2026-08-13T10:00:00.000Z",
      observationId: "runtime-start:epoch-1:sequence-4",
      statuses: [{ agentId: agent.id, bindingId, status: "RUNNING" }],
    });
    expect(fake.query.mock.calls.map(([sql]) => String(sql))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("pg_advisory_xact_lock"),
        expect.stringContaining("UPDATE agent_world.world_event_stream"),
        expect.stringContaining("INSERT INTO agent_world.world_events"),
        expect.stringContaining("INSERT INTO agent_world.world_agent_status"),
      ]),
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("does not append an event when the canonical status is unchanged", async () => {
    const fake = pool([[], [], [{ status: "IDLE" }], []]);
    await new PostgresWorldProjectionStore(fake.value).applyOpenClawSnapshot({
      observedAt: "2026-08-13T10:00:00.000Z",
      observationId: "runtime-start:epoch-1:sequence-5",
      statuses: [{ agentId: agent.id, bindingId, status: "IDLE" }],
    });
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("world_events"))).toBe(false);
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("reads a restart-safe cursor and defaults Agents without events to OFFLINE", async () => {
    const fake = pool([
      [{ agent_id: agent.id, status: "RUNNING" }],
      [
        {
          sequence: "9",
          id: "event_44444444-4444-4444-4444-444444444444",
          occurred_at: "2026-08-13T10:00:00.000Z",
        },
      ],
    ]);
    const model = await new PostgresWorldProjectionStore(fake.value).readWorld([
      agent,
      AgentSchema.parse({
        ...agent,
        id: "agent_55555555-5555-5555-5555-555555555555",
        slug: "reviewer",
      }),
    ]);
    expect(model.cursor).toEqual({
      schemaVersion: 1,
      stream: "WORLD",
      lastSequence: 9,
      lastEventId: "event_44444444-4444-4444-4444-444444444444",
    });
    expect(model.agents.map(({ status }) => status)).toEqual(["RUNNING", "OFFLINE"]);
  });
});
