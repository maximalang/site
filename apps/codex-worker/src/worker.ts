import {
  CodexExecutionError,
  type CodexExecutionEvent,
  type CodexExecutionRequest,
  CodexExecutionRequestSchema,
  type CodexExecutionRunner,
} from "@agent-world/codex-adapter";
import { type WorkspacePolicy, WorkspacePolicyError } from "./workspace-policy.js";

type ExecutionClaim = {
  externalRunId: string;
  attempt: number;
  leaseExpiresAt: string;
  request: CodexExecutionRequest;
};

export interface CodexWorkerStore {
  recoverExpired(): Promise<{ interrupted: number }>;
  claim(workerId: string, leaseMs: number): Promise<ExecutionClaim | undefined>;
  renewLease(
    executionId: string,
    workerId: string,
    leaseMs: number,
  ): Promise<{ leaseExpiresAt: string }>;
  appendEvent(
    executionId: string,
    workerId: string,
    event: CodexExecutionEvent,
  ): Promise<{ outcome: "APPLIED" | "REPLAY"; sequence: number }>;
}

export class CodexWorkerCycleError extends Error {
  constructor() {
    super("WORKER_CYCLE_FAILED");
    this.name = "CodexWorkerCycleError";
  }
}

export class CodexWorker {
  private readonly now: () => string;

  constructor(
    private readonly options: {
      store: CodexWorkerStore;
      runner: CodexExecutionRunner;
      workspacePolicy: WorkspacePolicy;
      workerId: string;
      leaseMs: number;
      now?: () => string;
    },
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async runOnce(
    signal?: AbortSignal,
  ): Promise<
    | { outcome: "IDLE"; interrupted: number }
    | { outcome: "POLICY_REJECTED"; executionId: string; interrupted: number }
    | { outcome: "PROCESSED"; executionId: string; interrupted: number }
  > {
    let interrupted: number;
    let claim: ExecutionClaim | undefined;
    try {
      interrupted = (await this.options.store.recoverExpired()).interrupted;
      claim = await this.options.store.claim(this.options.workerId, this.options.leaseMs);
    } catch {
      throw new CodexWorkerCycleError();
    }
    if (!claim) return { outcome: "IDLE", interrupted };

    let workingDirectory: string;
    try {
      workingDirectory = await this.options.workspacePolicy.resolve(
        claim.request.policy.workingDirectory,
      );
    } catch (error) {
      if (!(error instanceof WorkspacePolicyError)) throw new CodexWorkerCycleError();
      try {
        await this.options.store.appendEvent(claim.externalRunId, this.options.workerId, {
          schemaVersion: 1,
          sequence: 1,
          eventType: "RUN_FAILED",
          occurredAt: this.now(),
          failureCode: "POLICY_VIOLATION",
        });
      } catch {
        throw new CodexWorkerCycleError();
      }
      return { outcome: "POLICY_REJECTED", executionId: claim.externalRunId, interrupted };
    }

    const request = CodexExecutionRequestSchema.parse({
      ...claim.request,
      policy: { ...claim.request.policy, workingDirectory },
    });
    const renewalAbort = new AbortController();
    const executionSignal = signal
      ? AbortSignal.any([signal, renewalAbort.signal])
      : renewalAbort.signal;
    let renewalFailed = false;
    let renewalInFlight: Promise<void> | undefined;
    const renew = async () => {
      await this.options.store.renewLease(
        claim.externalRunId,
        this.options.workerId,
        this.options.leaseMs,
      );
    };
    try {
      await renew();
    } catch {
      throw new CodexWorkerCycleError();
    }
    const heartbeat = setInterval(
      () => {
        if (renewalInFlight) return;
        renewalInFlight = renew()
          .catch(() => {
            renewalFailed = true;
            renewalAbort.abort();
          })
          .finally(() => {
            renewalInFlight = undefined;
          });
      },
      Math.max(1_000, Math.floor(this.options.leaseMs / 3)),
    );
    heartbeat.unref?.();
    try {
      await this.options.runner.run(
        request,
        async (event) =>
          this.options.store.appendEvent(claim.externalRunId, this.options.workerId, event),
        executionSignal,
      );
    } catch (error) {
      if (
        renewalFailed ||
        !(error instanceof CodexExecutionError) ||
        error.code === "DISPATCH_UNAVAILABLE"
      ) {
        throw new CodexWorkerCycleError();
      }
    } finally {
      clearInterval(heartbeat);
      await renewalInFlight;
    }
    if (renewalFailed) throw new CodexWorkerCycleError();
    return { outcome: "PROCESSED", executionId: claim.externalRunId, interrupted };
  }
}
