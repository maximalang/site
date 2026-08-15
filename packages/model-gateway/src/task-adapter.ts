import type { TaskExecutionAdapter } from "@agent-world/conversation-service";
import {
  AgentIdSchema,
  BindingIdSchema,
  ContextPackSchema,
  IdempotencyKeySchema,
  ModelRouteIdSchema,
  OpaqueExternalIdSchema,
  RouteIdSchema,
  RunIdSchema,
  SessionIdSchema,
  TaskIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import * as z from "zod";
import { ModelGatewayFailure } from "./contract.js";

const AdapterKindSchema = z.enum(["API_MODEL", "LOCAL_MODEL"]);
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
      context.addIssue({ code: "custom", message: "Context Pack execution identity mismatch" });
    }
  });
const BindingResolutionSchema = z.strictObject({
  routeId: RouteIdSchema,
  modelRouteId: ModelRouteIdSchema,
  mode: z.enum(["API", "LOCAL"]),
});
export const ModelTaskExecutionRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  adapterKind: AdapterKindSchema,
  runId: RunIdSchema,
  taskId: TaskIdSchema,
  agentId: AgentIdSchema,
  bindingId: BindingIdSchema,
  sessionId: SessionIdSchema,
  routeId: RouteIdSchema,
  modelRouteId: ModelRouteIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  prompt: z.string().trim().min(1).max(2_000_000),
  maxOutputTokens: z.number().int().min(1).max(128_000),
});
export type ModelTaskExecutionRequest = z.infer<typeof ModelTaskExecutionRequestSchema>;
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

export interface ModelTaskBindingResolver {
  resolve(input: {
    bindingId: z.infer<typeof BindingIdSchema>;
    agentId: z.infer<typeof AgentIdSchema>;
    adapterKind: z.infer<typeof AdapterKindSchema>;
  }): Promise<unknown>;
}
export interface ModelExecutionDispatcher {
  dispatch(input: ModelTaskExecutionRequest): Promise<unknown>;
  observe(externalRunId: string, timeoutMs: number): Promise<unknown>;
}

export class ModelTaskExecutionAdapter implements TaskExecutionAdapter {
  readonly kind: z.infer<typeof AdapterKindSchema>;

  constructor(
    private readonly options: {
      kind: z.infer<typeof AdapterKindSchema>;
      resolver: ModelTaskBindingResolver;
      dispatcher: ModelExecutionDispatcher;
    },
  ) {
    this.kind = AdapterKindSchema.parse(options.kind);
  }

  async executeTask(inputValue: unknown) {
    const input = TaskExecutionInputSchema.parse(inputValue);
    let resolution: z.infer<typeof BindingResolutionSchema>;
    try {
      resolution = BindingResolutionSchema.parse(
        await this.options.resolver.resolve({
          bindingId: input.bindingId,
          agentId: input.agentId,
          adapterKind: this.kind,
        }),
      );
    } catch {
      throw new ModelGatewayFailure("ROUTE_UNAVAILABLE", "Model binding is unavailable");
    }
    const expectedMode = this.kind === "API_MODEL" ? "API" : "LOCAL";
    if (resolution.mode !== expectedMode || resolution.routeId !== input.contextPack.routeId) {
      throw new ModelGatewayFailure("ROUTE_UNAVAILABLE", "Model binding provenance mismatch");
    }
    const request = ModelTaskExecutionRequestSchema.parse({
      schemaVersion: 1,
      adapterKind: this.kind,
      runId: input.runId,
      taskId: input.taskId,
      agentId: input.agentId,
      bindingId: input.bindingId,
      sessionId: input.sessionId,
      routeId: resolution.routeId,
      modelRouteId: resolution.modelRouteId,
      idempotencyKey: input.idempotencyKey,
      prompt: input.contextPack.rendered,
      maxOutputTokens: Math.min(128_000, Math.max(256, input.contextPack.tokenBudget)),
    });
    try {
      return DispatchReceiptSchema.parse(await this.options.dispatcher.dispatch(request));
    } catch (error) {
      if (error instanceof ModelGatewayFailure) throw error;
      throw new ModelGatewayFailure("UPSTREAM_UNAVAILABLE", "Model execution dispatch failed");
    }
  }

  async waitForTask(externalRunIdValue: string, timeoutMsValue: number) {
    const externalRunId = OpaqueExternalIdSchema.parse(externalRunIdValue);
    const timeoutMs = z.number().int().min(0).max(30_000).parse(timeoutMsValue);
    try {
      return ObservationSchema.parse(
        await this.options.dispatcher.observe(externalRunId, timeoutMs),
      );
    } catch (error) {
      if (error instanceof ModelGatewayFailure) throw error;
      throw new ModelGatewayFailure("UPSTREAM_UNAVAILABLE", "Model execution observation failed");
    }
  }
}
