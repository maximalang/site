import { describe, expect, it, vi } from "vitest";
import { ScheduleSupervisor } from "./schedule-supervisor";

describe("ScheduleSupervisor", () => {
  it("coalesces concurrent ticks and records durable firings", async () => {
    let release!: (value: unknown[]) => void;
    const materializeDue = vi.fn(() => new Promise<unknown[]>((resolve) => (release = resolve)));
    const record = vi.fn();
    const supervisor = new ScheduleSupervisor({
      store: { materializeDue },
      record,
      now: () => "2026-08-15T12:00:00.000Z",
    });
    const first = supervisor.materializeOnce();
    const second = supervisor.materializeOnce();
    expect(first).toBe(second);
    expect(materializeDue).toHaveBeenCalledWith("2026-08-15T12:00:00.000Z", 25);
    release([{}, {}]);
    await first;
    expect(record).toHaveBeenCalledWith({
      event: "schedule_materialization",
      outcome: "COMPLETED",
      firingCount: 2,
    });
  });

  it("contains store and telemetry failures", async () => {
    const record = vi.fn(() => {
      throw new Error("telemetry");
    });
    const supervisor = new ScheduleSupervisor({
      store: { materializeDue: vi.fn().mockRejectedValue(new Error("database")) },
      record,
    });
    await expect(supervisor.materializeOnce()).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledWith({
      event: "schedule_materialization",
      outcome: "FAILED",
      firingCount: 0,
    });
  });

  it("rejects unsafe timing and batch configuration", () => {
    const base = { store: { materializeDue: async () => [] }, record: () => undefined };
    expect(() => new ScheduleSupervisor({ ...base, intervalMs: 999 })).toThrow(/interval/i);
    expect(() => new ScheduleSupervisor({ ...base, batchSize: 101 })).toThrow(/batch/i);
  });
});
