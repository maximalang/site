import { describe, expect, it, vi } from "vitest";
import { MissionHandoffSupervisor } from "./mission-handoff-supervisor";

describe("MissionHandoffSupervisor", () => {
  it("coalesces concurrent ticks and records activated handoffs", async () => {
    let release!: (value: unknown[]) => void;
    const activateReady = vi.fn(
      () =>
        new Promise<unknown[]>((resolve) => {
          release = resolve;
        }),
    );
    const record = vi.fn();
    const supervisor = new MissionHandoffSupervisor({
      store: { activateReady },
      record,
      now: () => "2026-08-15T12:00:00.000Z",
    });
    const first = supervisor.activateOnce();
    const second = supervisor.activateOnce();
    expect(first).toBe(second);
    release([{}]);
    await first;
    expect(activateReady).toHaveBeenCalledWith("2026-08-15T12:00:00.000Z", 25);
    expect(record).toHaveBeenCalledWith({
      event: "mission_handoff_activation",
      outcome: "COMPLETED",
      handoffCount: 1,
    });
  });

  it("contains store and telemetry failures", async () => {
    const record = vi.fn(() => {
      throw new Error("telemetry");
    });
    const supervisor = new MissionHandoffSupervisor({
      store: { activateReady: vi.fn().mockRejectedValue(new Error("database")) },
      record,
    });
    await expect(supervisor.activateOnce()).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledWith({
      event: "mission_handoff_activation",
      outcome: "FAILED",
      handoffCount: 0,
    });
  });
});
