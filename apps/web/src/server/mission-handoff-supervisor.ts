export type MissionHandoffTelemetry = {
  event: "mission_handoff_activation";
  outcome: "COMPLETED" | "FAILED";
  handoffCount: number;
};

export class MissionHandoffSupervisor {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;
  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly options: {
      store: { activateReady(now: string, limit: number): Promise<unknown[]> };
      record(event: MissionHandoffTelemetry): void;
      intervalMs?: number;
      batchSize?: number;
      now?: () => string;
    },
  ) {
    this.intervalMs = options.intervalMs ?? 5_000;
    this.batchSize = options.batchSize ?? 25;
    if (
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs < 1_000 ||
      this.intervalMs > 300_000
    )
      throw new Error("Mission handoff interval is invalid");
    if (!Number.isSafeInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 100)
      throw new Error("Mission handoff batch is invalid");
  }

  start(): void {
    if (this.timer) return;
    void this.activateOnce();
    this.timer = setInterval(() => void this.activateOnce(), this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  activateOnce(): Promise<void> {
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
      const handoffs = await this.options.store.activateReady(
        (this.options.now ?? (() => new Date().toISOString()))(),
        this.batchSize,
      );
      this.safeRecord({
        event: "mission_handoff_activation",
        outcome: "COMPLETED",
        handoffCount: handoffs.length,
      });
    } catch {
      this.safeRecord({ event: "mission_handoff_activation", outcome: "FAILED", handoffCount: 0 });
    }
  }

  private safeRecord(event: MissionHandoffTelemetry): void {
    try {
      this.options.record(event);
    } catch {
      /* Telemetry never interrupts durable handoffs. */
    }
  }
}
