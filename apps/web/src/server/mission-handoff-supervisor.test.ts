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
      store: { activateReady, listPolicyAuthorized: vi.fn().mockResolvedValue([]) },
      approve: vi.fn(),
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
      approvalCount: 0,
      approvalFailureCount: 0,
    });
  });

  it("contains store and telemetry failures", async () => {
    const record = vi.fn(() => {
      throw new Error("telemetry");
    });
    const supervisor = new MissionHandoffSupervisor({
      store: {
        activateReady: vi.fn().mockRejectedValue(new Error("database")),
        listPolicyAuthorized: vi.fn(),
      },
      approve: vi.fn(),
      record,
    });
    await expect(supervisor.activateOnce()).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledWith({
      event: "mission_handoff_activation",
      outcome: "FAILED",
      handoffCount: 0,
      approvalCount: 0,
      approvalFailureCount: 0,
    });
  });

  it("retries durable policy candidates and contains one approval failure", async () => {
    const candidate = { taskId: "task_1", missionId: "mission_1", approvalId: "approval_1" };
    const approve = vi
      .fn()
      .mockRejectedValueOnce(new Error("route unavailable"))
      .mockResolvedValue({});
    const record = vi.fn();
    const supervisor = new MissionHandoffSupervisor({
      store: {
        activateReady: vi.fn().mockResolvedValue([]),
        listPolicyAuthorized: vi.fn().mockResolvedValue([candidate]),
      },
      approve,
      record,
      now: () => "2026-08-15T12:00:00.000Z",
    });
    await supervisor.activateOnce();
    await supervisor.activateOnce();
    expect(approve).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ outcome: "FAILED", approvalFailureCount: 1 }),
    );
    expect(record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ outcome: "COMPLETED", approvalCount: 1 }),
    );
  });
});
