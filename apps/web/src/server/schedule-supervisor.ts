export type ScheduleSupervisorTelemetry = {
  event: "schedule_materialization";
  outcome: "COMPLETED" | "FAILED";
  firingCount: number;
};

export class ScheduleSupervisor {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;
  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly options: {
      store: { materializeDue(now: string, limit: number): Promise<unknown[]> };
      record(event: ScheduleSupervisorTelemetry): void;
      intervalMs?: number;
      batchSize?: number;
      now?: () => string;
    },
  ) {
    this.intervalMs = options.intervalMs ?? 30_000;
    this.batchSize = options.batchSize ?? 25;
    if (
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs < 1_000 ||
      this.intervalMs > 300_000
    ) {
      throw new Error("Schedule supervisor interval is invalid");
    }
    if (!Number.isSafeInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 100) {
      throw new Error("Schedule supervisor batch is invalid");
    }
  }

  start(): void {
    if (this.timer) return;
    void this.materializeOnce();
    this.timer = setInterval(() => void this.materializeOnce(), this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  materializeOnce(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    let work: Promise<void>;
    work = this.run().finally(() => {
      if (this.inFlight === work) this.inFlight = undefined;
    });
    this.inFlight = work;
    return work;
  }

  private async run(): Promise<void> {
    try {
      const firings = await this.options.store.materializeDue(
        (this.options.now ?? (() => new Date().toISOString()))(),
        this.batchSize,
      );
      this.safeRecord({
        event: "schedule_materialization",
        outcome: "COMPLETED",
        firingCount: firings.length,
      });
    } catch {
      this.safeRecord({ event: "schedule_materialization", outcome: "FAILED", firingCount: 0 });
    }
  }

  private safeRecord(event: ScheduleSupervisorTelemetry): void {
    try {
      this.options.record(event);
    } catch {
      // Telemetry never interrupts durable schedule materialization.
    }
  }
}
