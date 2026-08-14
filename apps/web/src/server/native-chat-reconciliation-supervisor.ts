export type NativeChatReconciliationTelemetry = {
  event: "native_chat_reconciliation";
  outcome: "COMPLETED" | "FAILED";
  candidates: number;
  reconciled: number;
  raced: number;
};

export class NativeChatReconciliationSupervisor {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly options: {
      store: {
        reconcileExpired(limit: number): Promise<{
          candidates: number;
          reconciled: number;
          raced: number;
        }>;
      };
      record(event: NativeChatReconciliationTelemetry): void;
      intervalMs?: number;
      batchSize?: number;
    },
  ) {
    const interval = options.intervalMs ?? 30_000;
    const batch = options.batchSize ?? 50;
    if (!Number.isSafeInteger(interval) || interval < 1_000 || interval > 300_000) {
      throw new Error("Native Chat reconciliation interval is invalid");
    }
    if (!Number.isSafeInteger(batch) || batch < 1 || batch > 500) {
      throw new Error("Native Chat reconciliation batch is invalid");
    }
  }

  start() {
    if (this.timer) return;
    void this.reconcileOnce();
    this.timer = setInterval(() => void this.reconcileOnce(), this.options.intervalMs ?? 30_000);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  reconcileOnce(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    let work: Promise<void>;
    work = this.run().finally(() => {
      if (this.inFlight === work) this.inFlight = undefined;
    });
    this.inFlight = work;
    return work;
  }

  private async run() {
    try {
      const result = await this.options.store.reconcileExpired(this.options.batchSize ?? 50);
      this.safeRecord({ event: "native_chat_reconciliation", outcome: "COMPLETED", ...result });
    } catch {
      this.safeRecord({
        event: "native_chat_reconciliation",
        outcome: "FAILED",
        candidates: 0,
        reconciled: 0,
        raced: 0,
      });
    }
  }

  private safeRecord(event: NativeChatReconciliationTelemetry) {
    try {
      this.options.record(event);
    } catch {
      // Telemetry never interrupts durable reconciliation.
    }
  }
}
