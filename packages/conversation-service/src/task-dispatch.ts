import {
  AgentIdSchema,
  BindingIdSchema,
  type ContextPack,
  ContextPackSchema,
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
const WaitTimeoutSchema = z.number().int().min(0).max(30_000);
const WaitResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("RUNNING"), observedAt: TimestampSchema }),
  z.strictObject({ status: z.literal("COMPLETED"), observedAt: TimestampSchema }),
  z.strictObject({
    status: z.literal("FAILED"),
    failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    observedAt: TimestampSchema,
  }),
]);

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
  markTerminal?(
    input:
      | { runId: Run["id"]; status: "COMPLETED"; completedAt: string }
      | { runId: Run["id"]; status: "FAILED"; failureCode: string; completedAt: string },
  ): Promise<unknown>;
}

export interface TaskContextPackProvider {
  prepare(runId: Run["id"]): Promise<unknown>;
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
  contextPack: ContextPack;
};

export interface TaskExecutionAdapter {
  readonly kind: ExecutionAdapterKind;
  executeTask(input: TaskExecutionInput): Promise<unknown>;
  waitForTask?(externalRunId: string, timeoutMs: number): Promise<unknown>;
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
      contextPacks: TaskContextPackProvider;
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
    if (parsedRun.data.adapterKind === "NATIVE_CHATGPT") {
      throw new TaskDispatchError("DISPATCH_UNAVAILABLE");
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
    let contextPack: ContextPack;
    try {
      contextPack = ContextPackSchema.parse(
        await this.options.contextPacks.prepare(parsedRun.data.id),
      );
    } catch {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
    }
    if (
      contextPack.runId !== parsedRun.data.id ||
      contextPack.taskId !== parsedRun.data.taskId ||
      contextPack.agentId !== parsedRun.data.agentId
    ) {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
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
          contextPack,
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

  async observe(
    runIdInput: unknown,
    timeoutMsInput: unknown,
  ): Promise<{ outcome: "RUNNING" | "COMPLETED" | "FAILED"; run: Run }> {
    const parsedRunId = RunIdSchema.safeParse(runIdInput);
    const timeoutMs = WaitTimeoutSchema.safeParse(timeoutMsInput);
    if (!parsedRunId.success || !timeoutMs.success) {
      throw new TaskDispatchError("INVALID_RUN");
    }
    let prepared: PrepareTaskDispatchResult;
    try {
      prepared = await this.options.store.prepare(parsedRunId.data);
    } catch {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
    }
    const current = RunSchema.safeParse(prepared.run);
    if (!current.success || current.data.id !== parsedRunId.data) {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
    }
    if (current.data.status === "DISPATCH_PENDING") {
      const dispatched = await this.dispatch(current.data.id);
      return this.observe(dispatched.run.id, timeoutMs.data);
    }
    if (current.data.status === "COMPLETED" || current.data.status === "FAILED") {
      return { outcome: current.data.status, run: current.data };
    }
    if (current.data.status !== "RUNNING" || !current.data.externalRunId) {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
    }
    let adapter: TaskExecutionAdapter | undefined;
    try {
      adapter = this.options.adapters.resolve(current.data.adapterKind);
    } catch {
      adapter = undefined;
    }
    if (!adapter || adapter.kind !== current.data.adapterKind || !adapter.waitForTask) {
      throw new TaskDispatchError("DISPATCH_UNAVAILABLE");
    }
    let observation: z.infer<typeof WaitResultSchema>;
    try {
      observation = WaitResultSchema.parse(
        await adapter.waitForTask(current.data.externalRunId, timeoutMs.data),
      );
    } catch {
      throw new TaskDispatchError("DISPATCH_FAILED");
    }
    if (observation.status === "RUNNING") {
      return { outcome: "RUNNING" as const, run: current.data };
    }
    if (!this.options.store.markTerminal) {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
    }
    let transitioned: unknown;
    try {
      transitioned = await this.options.store.markTerminal(
        observation.status === "COMPLETED"
          ? {
              runId: current.data.id,
              status: "COMPLETED",
              completedAt: observation.observedAt,
            }
          : {
              runId: current.data.id,
              status: "FAILED",
              failureCode: observation.failureCode,
              completedAt: observation.observedAt,
            },
      );
    } catch {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
    }
    const terminal = RunSchema.safeParse((transitioned as { run?: unknown })?.run);
    if (
      !terminal.success ||
      terminal.data.id !== current.data.id ||
      terminal.data.status !== observation.status
    ) {
      throw new TaskDispatchError("PERSISTENCE_FAILED");
    }
    return { outcome: observation.status, run: terminal.data };
  }
}
