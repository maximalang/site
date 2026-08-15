import {
  type ModelRouteId,
  ModelRouteIdSchema,
  type RunId,
  RunIdSchema,
  ToolIdSchema,
} from "@agent-world/domain";
import * as z from "zod";

const CorrelationKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const ToolNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
const JsonObjectSchema = z
  .record(z.string().min(1).max(128), z.json())
  .refine((value) => Object.keys(value).length <= 128, "JSON object has too many keys")
  .refine((value) => JSON.stringify(value).length <= 65_536, "JSON object is too large");

export const ModelGatewayMessageSchema = z.strictObject({
  role: z.enum(["SYSTEM", "USER", "ASSISTANT", "TOOL"]),
  content: z.string().max(1_000_000),
  toolCallId: CorrelationKeySchema.optional(),
});
export type ModelGatewayMessage = z.infer<typeof ModelGatewayMessageSchema>;

export const ModelGatewayToolSchema = z.strictObject({
  toolId: ToolIdSchema,
  name: ToolNameSchema,
  description: z.string().trim().min(1).max(4_000),
  inputSchema: JsonObjectSchema,
});
export type ModelGatewayTool = z.infer<typeof ModelGatewayToolSchema>;

export const ModelGatewayRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  modelRouteId: ModelRouteIdSchema,
  messages: z.array(ModelGatewayMessageSchema).min(1).max(256),
  tools: z.array(ModelGatewayToolSchema).max(64).optional(),
  maxOutputTokens: z.number().int().min(1).max(128_000),
  temperature: z.number().min(0).max(2).finite(),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  idempotencyKey: CorrelationKeySchema,
});
export type ModelGatewayRequest = z.infer<typeof ModelGatewayRequestSchema>;

export const ModelGatewayToolCallSchema = z.strictObject({
  callId: CorrelationKeySchema,
  name: ToolNameSchema,
  arguments: JsonObjectSchema,
});
export type ModelGatewayToolCall = z.infer<typeof ModelGatewayToolCallSchema>;

export const ModelGatewayUsageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative().max(100_000_000),
    outputTokens: z.number().int().nonnegative().max(10_000_000),
    totalTokens: z.number().int().nonnegative().max(110_000_000),
    cachedInputTokens: z.number().int().nonnegative().max(100_000_000).optional(),
    reasoningOutputTokens: z.number().int().nonnegative().max(10_000_000).optional(),
  })
  .superRefine((usage, context) => {
    if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
      context.addIssue({ code: "custom", message: "Total tokens must equal input plus output" });
    }
    if ((usage.cachedInputTokens ?? 0) > usage.inputTokens) {
      context.addIssue({ code: "custom", message: "Cached input tokens exceed input tokens" });
    }
    if ((usage.reasoningOutputTokens ?? 0) > usage.outputTokens) {
      context.addIssue({ code: "custom", message: "Reasoning tokens exceed output tokens" });
    }
  });
export type ModelGatewayUsage = z.infer<typeof ModelGatewayUsageSchema>;

export const ModelGatewayResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    runId: RunIdSchema,
    modelRouteId: ModelRouteIdSchema,
    upstreamRequestId: CorrelationKeySchema.optional(),
    finishReason: z.enum(["STOP", "LENGTH", "TOOL_CALLS", "CONTENT_FILTER"]),
    content: z.string().max(1_000_000),
    toolCalls: z.array(ModelGatewayToolCallSchema).max(64),
    usage: ModelGatewayUsageSchema,
    monetaryCost: z
      .strictObject({
        amountUsd: z.number().finite().nonnegative().max(1_000_000_000),
        source: z.literal("LITELLM_RESPONSE_HEADER"),
        estimated: z.literal(true),
      })
      .optional(),
  })
  .superRefine((result, context) => {
    if (result.finishReason === "TOOL_CALLS" && result.toolCalls.length === 0) {
      context.addIssue({ code: "custom", message: "TOOL_CALLS requires at least one tool call" });
    }
    if (result.finishReason !== "TOOL_CALLS" && result.toolCalls.length > 0) {
      context.addIssue({ code: "custom", message: "Tool calls require TOOL_CALLS finish reason" });
    }
  });
export type ModelGatewayResult = z.infer<typeof ModelGatewayResultSchema>;

export const ModelGatewayHealthSchema = z.strictObject({
  schemaVersion: z.literal(1),
  status: z.enum(["READY", "DEGRADED", "UNAVAILABLE"]),
  checkedAt: z.iso.datetime({ offset: true }),
});
export type ModelGatewayHealth = z.infer<typeof ModelGatewayHealthSchema>;

export const ModelGatewayFailureCodeSchema = z.enum([
  "INVALID_REQUEST",
  "ROUTE_UNAVAILABLE",
  "UPSTREAM_AUTH",
  "RATE_LIMITED",
  "CONTENT_FILTERED",
  "TIMEOUT",
  "CANCELLED",
  "INVALID_UPSTREAM_RESPONSE",
  "UPSTREAM_UNAVAILABLE",
]);
export type ModelGatewayFailureCode = z.infer<typeof ModelGatewayFailureCodeSchema>;

const RETRYABLE_FAILURES = new Set<ModelGatewayFailureCode>([
  "RATE_LIMITED",
  "TIMEOUT",
  "UPSTREAM_UNAVAILABLE",
]);

export class ModelGatewayFailure extends Error {
  readonly code: ModelGatewayFailureCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(code: ModelGatewayFailureCode, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "ModelGatewayFailure";
    this.code = ModelGatewayFailureCodeSchema.parse(code);
    this.retryable = RETRYABLE_FAILURES.has(code);
    if (retryAfterMs !== undefined) {
      if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > 86_400_000) {
        throw new TypeError("retryAfterMs must be an integer between 0 and 86400000");
      }
      this.retryAfterMs = retryAfterMs;
    }
  }
}

export interface ModelGateway {
  complete(
    request: ModelGatewayRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ModelGatewayResult>;
  health(options?: { signal?: AbortSignal }): Promise<ModelGatewayHealth>;
}

export function parseModelGatewayRequest(value: unknown): ModelGatewayRequest {
  return ModelGatewayRequestSchema.parse(value);
}

export function assertMatchingGatewayResult(
  request: Pick<ModelGatewayRequest, "runId" | "modelRouteId">,
  value: unknown,
): ModelGatewayResult {
  const result = ModelGatewayResultSchema.parse(value);
  if (result.runId !== request.runId || result.modelRouteId !== request.modelRouteId) {
    throw new ModelGatewayFailure(
      "INVALID_UPSTREAM_RESPONSE",
      "Gateway response identity mismatch",
    );
  }
  return result;
}

export type ModelGatewayRouteIdentity = {
  runId: RunId;
  modelRouteId: ModelRouteId;
};
