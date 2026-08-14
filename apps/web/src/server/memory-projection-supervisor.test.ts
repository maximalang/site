import { describe, expect, it, vi } from "vitest";
import { MemoryProjectionSupervisor } from "./memory-projection-supervisor";

describe("MemoryProjectionSupervisor", () => {
  it("serializes projection batches and records bounded outcomes", async () => {
    let release: (() => void) | undefined;
    const runBatch = vi.fn(
      () =>
        new Promise<{ applied: number; appliedThrough: number }>((resolve) => {
          release = () => resolve({ applied: 2, appliedThrough: 4 });
        }),
    );
    const record = vi.fn();
    const supervisor = new MemoryProjectionSupervisor({ projector: { runBatch }, record });
    const first = supervisor.reconcileOnce();
    const second = supervisor.reconcileOnce();
    expect(runBatch).toHaveBeenCalledOnce();
    release?.();
    await Promise.all([first, second]);
    expect(record).toHaveBeenCalledWith({
      event: "memory_graph_projection",
      outcome: "APPLIED",
      applied: 2,
      appliedThrough: 4,
    });
  });

  it("isolates adapter failures from the canonical runtime", async () => {
    const record = vi.fn();
    const supervisor = new MemoryProjectionSupervisor({
      projector: { runBatch: vi.fn(async () => Promise.reject(new Error("offline"))) },
      record,
    });
    await expect(supervisor.reconcileOnce()).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledWith({
      event: "memory_graph_projection",
      outcome: "FAILED",
      applied: 0,
      appliedThrough: 0,
    });
  });
});
