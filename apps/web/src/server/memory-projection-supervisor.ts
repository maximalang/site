export type MemoryProjectionSupervisorEvent = {
  event: "memory_graph_projection";
  outcome: "APPLIED" | "IDLE" | "FAILED";
  applied: number;
  appliedThrough: number;
};

export class MemoryProjectionSupervisor {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;
  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly options: {
      projector: {
        runBatch(limit: number): Promise<{ applied: number; appliedThrough: number }>;
      };
      record(event: MemoryProjectionSupervisorEvent): void;
      intervalMs?: number;
      batchSize?: number;
    },
  ) {
    this.intervalMs = options.intervalMs ?? 5_000;
    this.batchSize = options.batchSize ?? 100;
    if (
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs < 1_000 ||
      this.intervalMs > 300_000 ||
      !Number.isSafeInteger(this.batchSize) ||
      this.batchSize < 1 ||
      this.batchSize > 500
    ) {
      throw new Error("Memory projection supervisor configuration is invalid");
    }
  }

  start(): void {
    if (this.timer) return;
    void this.reconcileOnce();
    this.timer = setInterval(() => void this.reconcileOnce(), this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  reconcileOnce(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    let work: Promise<void>;
    work = this.runBatch().finally(() => {
      if (this.inFlight === work) this.inFlight = undefined;
    });
    this.inFlight = work;
    return work;
  }

  private async runBatch(): Promise<void> {
    try {
      const receipt = await this.options.projector.runBatch(this.batchSize);
      this.safeRecord({
        event: "memory_graph_projection",
        outcome: receipt.applied === 0 ? "IDLE" : "APPLIED",
        applied: receipt.applied,
        appliedThrough: receipt.appliedThrough,
      });
    } catch {
      this.safeRecord({
        event: "memory_graph_projection",
        outcome: "FAILED",
        applied: 0,
        appliedThrough: 0,
      });
    }
  }

  private safeRecord(event: MemoryProjectionSupervisorEvent): void {
    try {
      this.options.record(event);
    } catch {
      // Projection telemetry never interrupts the canonical runtime.
    }
  }
}
