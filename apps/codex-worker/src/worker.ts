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
    try {
      await this.options.runner.run(
        request,
        async (event) =>
          this.options.store.appendEvent(claim.externalRunId, this.options.workerId, event),
        signal,
      );
    } catch (error) {
      if (!(error instanceof CodexExecutionError)) throw new CodexWorkerCycleError();
    }
    return { outcome: "PROCESSED", executionId: claim.externalRunId, interrupted };
  }
}
