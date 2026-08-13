import {
  AgentIdSchema,
  BindingIdSchema,
  type ExecutionAdapterKind,
  ExecutionAdapterKindSchema,
  type IdempotencyKeySchema,
  OpaqueExternalIdSchema,
  type Run,
  RunIdSchema,
  RunSchema,
  SessionIdSchema,
  TaskIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import * as z from "zod";

const PreparedTaskSchema = z.strictObject({
  id: TaskIdSchema,
  agentId: AgentIdSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(20_000).optional(),
});
const PreparedBindingSchema = z.strictObject({
  id: BindingIdSchema,
  adapterKind: ExecutionAdapterKindSchema,
  externalAgentId: OpaqueExternalIdSchema,
});
const PreparedSessionSchema = z.strictObject({
  id: SessionIdSchema,
  externalSessionRef: OpaqueExternalIdSchema,
});
const ReceiptSchema = z.strictObject({
  acceptedAt: TimestampSchema,
  externalRunId: OpaqueExternalIdSchema,
});

export type PreparedTaskDispatch = {
  kind: "READY";
  run: Run;
  task: z.infer<typeof PreparedTaskSchema>;
  binding: z.infer<typeof PreparedBindingSchema>;
  session: z.infer<typeof PreparedSessionSchema>;
};

export type PrepareTaskDispatchResult =
  | PreparedTaskDispatch
  | { kind: "ALREADY_DISPATCHED"; run: Run };

export interface TaskDispatchStore {
  prepare(runId: Run["id"]): Promise<PrepareTaskDispatchResult>;
  markRunning(input: {
    runId: Run["id"];
    externalRunId: string;
    startedAt: string;
  }): Promise<unknown>;
}

export type TaskExecutionInput = {
  runId: Run["id"];
  taskId: z.infer<typeof TaskIdSchema>;
  agentId: z.infer<typeof AgentIdSchema>;
  bindingId: z.infer<typeof BindingIdSchema>;
  sessionId: z.infer<typeof SessionIdSchema>;
  externalAgentId: string;
  externalSessionRef: string;
  title: string;
  description?: string;
  idempotencyKey: z.infer<typeof IdempotencyKeySchema>;
};

export interface TaskExecutionAdapter {
  readonly kind: ExecutionAdapterKind;
  executeTask(input: TaskExecutionInput): Promise<unknown>;
}

export interface TaskExecutionAdapterRegistry {
  resolve(kind: ExecutionAdapterKind): TaskExecutionAdapter | undefined;
}

export type TaskDispatchErrorCode =
  | "INVALID_RUN"
  | "PERSISTENCE_FAILED"
  | "DISPATCH_UNAVAILABLE"
  | "DISPATCH_FAILED";

export class TaskDispatchError extends Error {
  constructor(readonly code: TaskDispatchErrorCode) {
    super(code);
    this.name = "TaskDispatchError";
  }
}

export class TaskDispatchService {
  constructor(
    private readonly options: {
      store: TaskDispatchStore;
      adapters: TaskExecutionAdapterRegistry;
    },
  ) {}

  async dispatch(runIdInput: unknown) {
    const parsedRunId = RunIdSchema.safeParse(runIdInput);
    if (!parsedRunId.success) throw new TaskDispatchError("INVALID_RUN");
    let prepared: PrepareTaskDispatchResult;
    try {
      prepared = await this.options.store.prepare(parsedRunId.data);
    } catch {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
    }
    const parsedRun = RunSchema.safeParse(prepared.run);
    if (!parsedRun.success || parsedRun.data.id !== parsedRunId.data) {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
    }
    if (prepared.kind === "ALREADY_DISPATCHED") {
      if (parsedRun.data.status === "DISPATCH_PENDING") {
        throw new TaskDispatchError("PERSISTENCE_FAILED");
      }
      return { outcome: "REPLAYED" as const, run: parsedRun.data };
    }
    const task = PreparedTaskSchema.safeParse(prepared.task);
    const binding = PreparedBindingSchema.safeParse(prepared.binding);
    const session = PreparedSessionSchema.safeParse(prepared.session);
    if (
      parsedRun.data.status !== "DISPATCH_PENDING" ||
      !task.success ||
      !binding.success ||
      !session.success ||
      task.data.id !== parsedRun.data.taskId ||
      task.data.agentId !== parsedRun.data.agentId ||
      binding.data.id !== parsedRun.data.bindingId ||
      binding.data.adapterKind !== parsedRun.data.adapterKind ||
      session.data.id !== parsedRun.data.sessionId
    ) {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
    }
    let adapter: TaskExecutionAdapter | undefined;
    try {
      adapter = this.options.adapters.resolve(parsedRun.data.adapterKind);
    } catch {
      adapter = undefined;
    }
    if (!adapter || adapter.kind !== parsedRun.data.adapterKind) {
      throw new TaskDispatchError("DISPATCH_UNAVAILABLE");
    }
    let receipt: z.infer<typeof ReceiptSchema>;
    try {
      receipt = ReceiptSchema.parse(
        await adapter.executeTask({
          runId: parsedRun.data.id,
          taskId: parsedRun.data.taskId,
          agentId: parsedRun.data.agentId,
          bindingId: parsedRun.data.bindingId,
          sessionId: parsedRun.data.sessionId,
          externalAgentId: binding.data.externalAgentId,
          externalSessionRef: session.data.externalSessionRef,
          title: task.data.title,
          ...(task.data.description === undefined ? {} : { description: task.data.description }),
          idempotencyKey: parsedRun.data.dispatchIdempotencyKey,
        }),
      );
    } catch {
      throw new TaskDispatchError("DISPATCH_FAILED");
    }
    let transitioned: unknown;
    try {
      transitioned = await this.options.store.markRunning({
        runId: parsedRun.data.id,
        externalRunId: receipt.externalRunId,
        startedAt: receipt.acceptedAt,
      });
    } catch {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
    }
    const candidate = transitioned as { run?: unknown };
    const running = RunSchema.safeParse(candidate?.run);
    if (
      !running.success ||
      running.data.id !== parsedRun.data.id ||
      running.data.status !== "RUNNING" ||
      running.data.externalRunId !== receipt.externalRunId
    ) {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
    }
    return { outcome: "DISPATCHED" as const, run: running.data };
  }
}
