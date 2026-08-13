import { RunSchema } from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import { TaskDispatchError, TaskDispatchService } from "./task-dispatch.js";

const run = RunSchema.parse({
  schemaVersion: 1,
  id: "run_11111111-1111-1111-1111-111111111111",
  taskId: "task_11111111-1111-1111-1111-111111111111",
  agentId: "agent_22222222-2222-2222-2222-222222222222",
  approvalId: "approval_11111111-1111-1111-1111-111111111111",
  adapterKind: "OPENCLAW",
  bindingId: "binding_33333333-3333-3333-3333-333333333333",
  sessionId: "session_44444444-4444-4444-4444-444444444444",
  status: "DISPATCH_PENDING",
  attempt: 0,
  dispatchIdempotencyKey: "run:11111111-1111-1111-1111-111111111111",
  createdAt: "2026-08-13T10:00:00.000Z",
});

const prepared = {
  kind: "READY" as const,
  run,
  task: {
    id: run.taskId,
    agentId: run.agentId,
    title: "Verify the protocol",
    description: "Use primary sources.",
  },
  binding: {
    id: run.bindingId,
    adapterKind: "OPENCLAW" as const,
    externalAgentId: "researcher",
  },
  session: {
    id: run.sessionId,
    externalSessionRef: "agent:researcher:protocol",
  },
};

describe("TaskDispatchService", () => {
  it("dispatches exact persisted provenance and records the accepted upstream Run", async () => {
    const prepare = vi.fn(async () => prepared);
    const markRunning = vi.fn(async (receipt) => ({
      outcome: "UPDATED" as const,
      run: {
        ...run,
        status: "RUNNING" as const,
        attempt: 1,
        externalRunId: receipt.externalRunId,
        startedAt: receipt.startedAt,
      },
    }));
    const executeTask = vi.fn(async () => ({
      acceptedAt: "2026-08-13T10:00:05.000Z",
      externalRunId: "openclaw-run-42",
    }));
    const service = new TaskDispatchService({
      store: { prepare, markRunning },
      adapters: { resolve: () => ({ kind: "OPENCLAW", executeTask }) },
    });

    await expect(service.dispatch(run.id)).resolves.toMatchObject({
      outcome: "DISPATCHED",
      run: { status: "RUNNING", externalRunId: "openclaw-run-42" },
    });
    expect(executeTask).toHaveBeenCalledWith({
      runId: run.id,
      taskId: run.taskId,
      agentId: run.agentId,
      bindingId: run.bindingId,
      sessionId: run.sessionId,
      externalAgentId: "researcher",
      externalSessionRef: "agent:researcher:protocol",
      title: "Verify the protocol",
      description: "Use primary sources.",
      idempotencyKey: run.dispatchIdempotencyKey,
    });
    expect(markRunning).toHaveBeenCalledWith({
      runId: run.id,
      externalRunId: "openclaw-run-42",
      startedAt: "2026-08-13T10:00:05.000Z",
    });
  });

  it("leaves the durable dispatch pending when the adapter is unavailable", async () => {
    const markRunning = vi.fn();
    const service = new TaskDispatchService({
      store: { prepare: async () => prepared, markRunning },
      adapters: { resolve: () => undefined },
    });
    await expect(service.dispatch(run.id)).rejects.toEqual(
      new TaskDispatchError("DISPATCH_UNAVAILABLE"),
    );
    expect(markRunning).not.toHaveBeenCalled();
  });

  it("leaves the same idempotent outbox item pending after an ambiguous adapter failure", async () => {
    const markRunning = vi.fn();
    const service = new TaskDispatchService({
      store: { prepare: async () => prepared, markRunning },
      adapters: {
        resolve: () => ({
          kind: "OPENCLAW",
          executeTask: async () => {
            throw new Error("provider detail must not escape");
          },
        }),
      },
    });
    await expect(service.dispatch(run.id)).rejects.toEqual(
      new TaskDispatchError("DISPATCH_FAILED"),
    );
    expect(markRunning).not.toHaveBeenCalled();
  });

  it("does not call the adapter again after the accepted receipt is canonical", async () => {
    const running = {
      ...run,
      status: "RUNNING" as const,
      attempt: 1,
      externalRunId: "openclaw-run-42",
      startedAt: "2026-08-13T10:00:05.000Z",
    };
    const executeTask = vi.fn();
    const service = new TaskDispatchService({
      store: {
        prepare: async () => ({ kind: "ALREADY_DISPATCHED" as const, run: running }),
        markRunning: vi.fn(),
      },
      adapters: { resolve: () => ({ kind: "OPENCLAW", executeTask }) },
    });
    await expect(service.dispatch(run.id)).resolves.toEqual({ outcome: "REPLAYED", run: running });
    expect(executeTask).not.toHaveBeenCalled();
  });
});
