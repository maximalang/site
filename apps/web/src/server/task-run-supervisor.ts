export type TaskRunSupervisorTelemetryEvent = {
  event: "task_run_reconciliation";
  outcome: "COMPLETED" | "RUN_FAILED" | "BATCH_FAILED";
  runCount: number;
};

export class TaskRunSupervisor {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;
  private readonly intervalMs: number;
  private readonly waitTimeoutMs: number;

  constructor(
    private readonly options: {
      source: { listActive(limit: number): Promise<string[]> };
      observer: { observe(runId: string, timeoutMs: number): Promise<unknown> };
      telemetry: { record(event: TaskRunSupervisorTelemetryEvent): void };
      intervalMs?: number;
      waitTimeoutMs?: number;
    },
  ) {
    this.intervalMs = options.intervalMs ?? 2_000;
    this.waitTimeoutMs = options.waitTimeoutMs ?? 1_000;
    if (
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs < 250 ||
      this.intervalMs > 60_000 ||
      !Number.isSafeInteger(this.waitTimeoutMs) ||
      this.waitTimeoutMs < 0 ||
      this.waitTimeoutMs > 30_000
    ) {
      throw new Error("Task Run supervisor timing is invalid");
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
    let runIds: string[];
    try {
      runIds = await this.options.source.listActive(4);
    } catch {
      this.safeRecord({ event: "task_run_reconciliation", outcome: "BATCH_FAILED", runCount: 0 });
      return;
    }
    if (runIds.length === 0) return;
    const results = await Promise.allSettled(
      runIds.map((runId) => this.options.observer.observe(runId, this.waitTimeoutMs)),
    );
    const failed = results.filter((result) => result.status === "rejected").length;
    this.safeRecord({
      event: "task_run_reconciliation",
      outcome: failed > 0 ? "RUN_FAILED" : "COMPLETED",
      runCount: runIds.length,
    });
  }

  private safeRecord(event: TaskRunSupervisorTelemetryEvent): void {
    try {
      this.options.telemetry.record(event);
    } catch {
      // Telemetry never interrupts durable reconciliation.
    }
  }
}
