import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import { PostgresRunDispatchStore, RunDispatchStoreError } from "./run-dispatch-store.js";

const pending = {
  id: "run_11111111-1111-1111-1111-111111111111",
  task_id: "task_11111111-1111-1111-1111-111111111111",
  agent_id: "agent_22222222-2222-2222-2222-222222222222",
  approval_id: "approval_11111111-1111-1111-1111-111111111111",
  adapter_kind: "OPENCLAW",
  binding_id: "binding_33333333-3333-3333-3333-333333333333",
  session_id: "session_44444444-4444-4444-4444-444444444444",
  status: "DISPATCH_PENDING",
  attempt: 0,
  dispatch_idempotency_key: "run:11111111-1111-1111-1111-111111111111",
  external_run_id: null,
  created_at: "2026-08-13T10:00:00.000Z",
  started_at: null,
  completed_at: null,
  failure_code: null,
  title: "Verify the protocol",
  description: "Use primary sources.",
  external_agent_id: "researcher",
  external_session_ref: "agent:researcher:protocol",
  binding_is_enabled: true,
  session_ended_at: null,
};

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

describe("PostgresRunDispatchStore", () => {
  it("loads only exact enabled Session and Binding provenance for pending dispatch", async () => {
    const fake = pool([[pending]]);
    const result = await new PostgresRunDispatchStore(fake.value).prepare(
      "run_11111111-1111-1111-1111-111111111111",
    );
    expect(result).toMatchObject({
      kind: "READY",
      run: { status: "DISPATCH_PENDING" },
      task: { title: "Verify the protocol" },
      binding: { externalAgentId: "researcher" },
      session: { externalSessionRef: "agent:researcher:protocol" },
    });
  });

  it("fails closed if the persisted dispatch route is no longer active", async () => {
    const fake = pool([[{ ...pending, binding_is_enabled: false }]]);
    await expect(new PostgresRunDispatchStore(fake.value).prepare(pending.id)).rejects.toEqual(
      new RunDispatchStoreError("ROUTE_UNAVAILABLE"),
    );
  });

  it("atomically records an accepted upstream Run and RUNNING event", async () => {
    const fake = pool([[], [], [pending], [], [{ last_sequence: "10" }], [], [], []]);
    const result = await new PostgresRunDispatchStore(fake.value, {
      eventId: () => "event_55555555-5555-5555-5555-555555555555",
    }).markRunning({
      runId: pending.id,
      externalRunId: "openclaw-run-42",
      startedAt: "2026-08-13T10:00:05.000Z",
    });
    expect(result).toMatchObject({ outcome: "UPDATED", run: { status: "RUNNING", attempt: 1 } });
    expect(fake.query.mock.calls.map(([sql]) => String(sql))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("UPDATE agent_world.runs"),
        expect.stringContaining("'AGENT_STATUS_CHANGED'"),
        expect.stringContaining("world_agent_status"),
      ]),
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("replays the exact accepted receipt but rejects conflicting upstream identity", async () => {
    const running = {
      ...pending,
      status: "RUNNING",
      attempt: 1,
      external_run_id: "openclaw-run-42",
      started_at: "2026-08-13T10:00:05.000Z",
    };
    const replay = pool([[], [], [running], []]);
    await expect(
      new PostgresRunDispatchStore(replay.value).markRunning({
        runId: pending.id,
        externalRunId: "openclaw-run-42",
        startedAt: "2026-08-13T10:00:06.000Z",
      }),
    ).resolves.toMatchObject({ outcome: "REPLAY", run: { status: "RUNNING" } });

    const conflict = pool([[], [], [running], []]);
    await expect(
      new PostgresRunDispatchStore(conflict.value).markRunning({
        runId: pending.id,
        externalRunId: "different-run",
        startedAt: "2026-08-13T10:00:06.000Z",
      }),
    ).rejects.toEqual(new RunDispatchStoreError("RECEIPT_CONFLICT"));
  });
});
