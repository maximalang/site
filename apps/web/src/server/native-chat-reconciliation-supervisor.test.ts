import { describe, expect, it, vi } from "vitest";
import { NativeChatReconciliationSupervisor } from "./native-chat-reconciliation-supervisor";

describe("NativeChatReconciliationSupervisor", () => {
  it("coalesces concurrent reconciliation and records bounded outcomes", async () => {
    let resolve:
      | ((value: { candidates: number; reconciled: number; raced: number }) => void)
      | undefined;
    const reconcileExpired = vi.fn(
      () =>
        new Promise<{ candidates: number; reconciled: number; raced: number }>((done) => {
          resolve = done;
        }),
    );
    const record = vi.fn();
    const supervisor = new NativeChatReconciliationSupervisor({
      store: { reconcileExpired },
      record,
    });

    const first = supervisor.reconcileOnce();
    const second = supervisor.reconcileOnce();
    expect(first).toBe(second);
    resolve?.({ candidates: 2, reconciled: 1, raced: 1 });
    await first;

    expect(reconcileExpired).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      event: "native_chat_reconciliation",
      outcome: "COMPLETED",
      candidates: 2,
      reconciled: 1,
      raced: 1,
    });
  });
});
