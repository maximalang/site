import type { TaskExecutionAdapter } from "@agent-world/conversation-service";
import {
  AccountIdSchema,
  AgentIdSchema,
  BindingIdSchema,
  ContextPackSchema,
  IdempotencyKeySchema,
  OpaqueExternalIdSchema,
  RouteIdSchema,
  RunIdSchema,
  SessionIdSchema,
  TaskIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import * as z from "zod";
import {
  CodexExecutionError,
  type CodexExecutionPolicy,
  CodexExecutionPolicySchema,
  type CodexExecutionRequest,
  CodexExecutionRequestSchema,
} from "./contract.js";

const TaskExecutionInputSchema = z
  .strictObject({
    runId: RunIdSchema,
    taskId: TaskIdSchema,
    agentId: AgentIdSchema,
    bindingId: BindingIdSchema,
    sessionId: SessionIdSchema,
    externalAgentId: OpaqueExternalIdSchema,
    externalSessionRef: OpaqueExternalIdSchema,
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(20_000).optional(),
    idempotencyKey: IdempotencyKeySchema,
    contextPack: ContextPackSchema,
  })
  .superRefine((input, context) => {
    if (
      input.contextPack.runId !== input.runId ||
      input.contextPack.taskId !== input.taskId ||
      input.contextPack.agentId !== input.agentId
    ) {
      context.addIssue({ code: "custom", message: "ContextPack execution identity mismatch" });
    }
  });

const BindingResolutionSchema = z.strictObject({
  routeId: RouteIdSchema,
  accountId: AccountIdSchema,
  policy: CodexExecutionPolicySchema,
});

const DispatchReceiptSchema = z.strictObject({
  acceptedAt: TimestampSchema,
  externalRunId: OpaqueExternalIdSchema,
});

const ObservationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("RUNNING"), observedAt: TimestampSchema }),
  z.strictObject({ status: z.literal("COMPLETED"), observedAt: TimestampSchema }),
  z.strictObject({
    status: z.literal("FAILED"),
    failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    observedAt: TimestampSchema,
  }),
]);

const ObservationTimeoutSchema = z.number().int().min(0).max(30_000);

export type CodexBindingResolution = {
  routeId: z.infer<typeof RouteIdSchema>;
  accountId: z.infer<typeof AccountIdSchema>;
  policy: CodexExecutionPolicy;
};

export interface CodexBindingResolver {
  resolve(input: {
    runId: z.infer<typeof RunIdSchema>;
    bindingId: z.infer<typeof BindingIdSchema>;
    agentId: z.infer<typeof AgentIdSchema>;
    externalAgentId: string;
  }): Promise<unknown>;
}

export interface CodexExecutionDispatcher {
  dispatch(request: CodexExecutionRequest): Promise<unknown>;
  observe(externalRunId: string, timeoutMs: number): Promise<unknown>;
}

export class CodexTaskExecutionAdapter implements TaskExecutionAdapter {
  readonly kind = "CODEX" as const;

  constructor(
    private readonly options: {
      resolver: CodexBindingResolver;
      dispatcher: CodexExecutionDispatcher;
    },
  ) {}

  async executeTask(inputValue: unknown) {
    const parsedInput = TaskExecutionInputSchema.safeParse(inputValue);
    if (!parsedInput.success) throw new CodexExecutionError("POLICY_VIOLATION");
    const input = parsedInput.data;
    let resolutionValue: unknown;
    try {
      resolutionValue = await this.options.resolver.resolve({
        runId: input.runId,
        bindingId: input.bindingId,
        agentId: input.agentId,
        externalAgentId: input.externalAgentId,
      });
    } catch {
      throw new CodexExecutionError("DISPATCH_UNAVAILABLE");
    }
    const resolution = BindingResolutionSchema.safeParse(resolutionValue);
    if (!resolution.success) throw new CodexExecutionError("POLICY_VIOLATION");
    if (input.contextPack.routeId !== resolution.data.routeId) {
      throw new CodexExecutionError("POLICY_VIOLATION");
    }
    const request = CodexExecutionRequestSchema.parse({
      schemaVersion: 1,
      runId: input.runId,
      taskId: input.taskId,
      agentId: input.agentId,
      bindingId: input.bindingId,
      routeId: resolution.data.routeId,
      accountId: resolution.data.accountId,
      sessionId: input.sessionId,
      codexThreadId: input.externalSessionRef,
      idempotencyKey: input.idempotencyKey,
      prompt: input.contextPack.rendered,
      policy: resolution.data.policy,
    });
    try {
      return DispatchReceiptSchema.parse(await this.options.dispatcher.dispatch(request));
    } catch (error) {
      if (error instanceof CodexExecutionError) throw error;
      throw new CodexExecutionError("DISPATCH_UNAVAILABLE");
    }
  }

  async waitForTask(externalRunIdValue: string, timeoutMsValue: number) {
    const externalRunId = OpaqueExternalIdSchema.safeParse(externalRunIdValue);
    const timeoutMs = ObservationTimeoutSchema.safeParse(timeoutMsValue);
    if (!externalRunId.success || !timeoutMs.success) {
      throw new CodexExecutionError("POLICY_VIOLATION");
    }
    try {
      return ObservationSchema.parse(
        await this.options.dispatcher.observe(externalRunId.data, timeoutMs.data),
      );
    } catch (error) {
      if (error instanceof CodexExecutionError) throw error;
      throw new CodexExecutionError("DISPATCH_UNAVAILABLE");
    }
  }
}
