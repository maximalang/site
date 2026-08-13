import { describe, expect, it, vi } from "vitest";
import { TaskRunSupervisor } from "./task-run-supervisor";

describe("TaskRunSupervisor", () => {
  it("reconciles one bounded batch and isolates individual Run failures", async () => {
    const listActive = vi.fn(async () => [
      "run_11111111-1111-1111-1111-111111111111",
      "run_22222222-2222-2222-2222-222222222222",
    ]);
    const observe = vi.fn(async (runId: string) => {
      if (runId.includes("2222")) throw new Error("provider detail");
      return { outcome: "COMPLETED" as const };
    });
    const record = vi.fn();
    const supervisor = new TaskRunSupervisor({
      source: { listActive },
      observer: { observe },
      telemetry: { record },
    });

    await supervisor.reconcileOnce();
    expect(listActive).toHaveBeenCalledWith(4);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenCalledWith("run_11111111-1111-1111-1111-111111111111", 1_000);
    expect(JSON.stringify(record.mock.calls)).not.toContain("provider detail");
  });

  it("coalesces overlapping reconciliation ticks", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const listActive = vi.fn(async () => {
      await gate;
      return [];
    });
    const supervisor = new TaskRunSupervisor({
      source: { listActive },
      observer: { observe: vi.fn() },
      telemetry: { record: vi.fn() },
    });
    const first = supervisor.reconcileOnce();
    const second = supervisor.reconcileOnce();
    release?.();
    await Promise.all([first, second]);
    expect(listActive).toHaveBeenCalledOnce();
  });
});
