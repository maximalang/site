import {
  AccountIdSchema,
  AgentIdSchema,
  IdempotencyKeySchema,
  OpaqueExternalIdSchema,
  RunIdSchema,
  SessionIdSchema,
  TaskIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import * as z from "zod";

const hasForbiddenControlCharacter = (value: string) =>
  [...value].some((character) => {
    const point = character.codePointAt(0);
    return (
      point !== undefined &&
      point < 32 &&
      character !== "\n" &&
      character !== "\r" &&
      character !== "\t"
    );
  });

const BoundedTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => !hasForbiddenControlCharacter(value));

const WorkingDirectorySchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => !hasForbiddenControlCharacter(value));

export const CodexExecutionPolicySchema = z.strictObject({
  workingDirectory: WorkingDirectorySchema,
  sandbox: z.enum(["READ_ONLY", "WORKSPACE_WRITE"]),
  approvalPolicy: z.enum(["NEVER", "ON_REQUEST", "UNTRUSTED"]),
  networkAccess: z.boolean(),
  timeoutMs: z.number().int().min(1_000).max(14_400_000),
  model: z.string().trim().min(1).max(200).optional(),
  reasoningEffort: z.enum(["MINIMAL", "LOW", "MEDIUM", "HIGH", "XHIGH"]).optional(),
});
export type CodexExecutionPolicy = z.infer<typeof CodexExecutionPolicySchema>;

export const CodexExecutionRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    runId: RunIdSchema,
    taskId: TaskIdSchema,
    agentId: AgentIdSchema,
    accountId: AccountIdSchema,
    sessionId: SessionIdSchema,
    codexThreadId: OpaqueExternalIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    prompt: BoundedTextSchema(50_000),
    policy: CodexExecutionPolicySchema,
  })
  .superRefine((request, context) => {
    const canonicalIds = new Set<string>([
      request.runId,
      request.taskId,
      request.agentId,
      request.accountId,
      request.sessionId,
    ]);
    if (canonicalIds.has(request.codexThreadId)) {
      context.addIssue({
        code: "custom",
        message: "Codex thread identity must be external",
        path: ["codexThreadId"],
      });
    }
  });
export type CodexExecutionRequest = z.infer<typeof CodexExecutionRequestSchema>;

const EventEnvelope = {
  schemaVersion: z.literal(1),
  sequence: z.number().int().positive(),
  occurredAt: TimestampSchema,
};

const RunStartedEventSchema = z.strictObject({
  ...EventEnvelope,
  eventType: z.literal("RUN_STARTED"),
  threadId: OpaqueExternalIdSchema,
  upstreamTurnId: OpaqueExternalIdSchema.optional(),
});

const ItemCompletedEventSchema = z.strictObject({
  ...EventEnvelope,
  eventType: z.literal("ITEM_COMPLETED"),
  itemId: OpaqueExternalIdSchema,
  itemType: z.enum([
    "MESSAGE",
    "COMMAND",
    "FILE_CHANGE",
    "MCP_CALL",
    "WEB_SEARCH",
    "REASONING",
    "TODO",
    "ERROR",
  ]),
  summary: BoundedTextSchema(20_000).optional(),
});

const FinalOutputEventSchema = z.strictObject({
  ...EventEnvelope,
  eventType: z.literal("FINAL_OUTPUT"),
  content: BoundedTextSchema(200_000),
});

const UsageRecordedEventSchema = z
  .strictObject({
    ...EventEnvelope,
    eventType: z.literal("USAGE_RECORDED"),
    usage: z.strictObject({
      inputTokens: z.number().int().nonnegative(),
      cachedInputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    }),
  })
  .refine((event) => event.usage.cachedInputTokens <= event.usage.inputTokens, {
    message: "Cached input cannot exceed input tokens",
    path: ["usage", "cachedInputTokens"],
  });

const RunCompletedEventSchema = z.strictObject({
  ...EventEnvelope,
  eventType: z.literal("RUN_COMPLETED"),
});

export const CodexExecutionFailureCodeSchema = z.enum([
  "AUTH_UNAVAILABLE",
  "POLICY_VIOLATION",
  "SDK_UNAVAILABLE",
  "TIMEOUT",
  "CANCELLED",
  "MALFORMED_EVENT",
  "EXECUTION_FAILED",
]);
export type CodexExecutionFailureCode = z.infer<typeof CodexExecutionFailureCodeSchema>;

const RunFailedEventSchema = z.strictObject({
  ...EventEnvelope,
  eventType: z.literal("RUN_FAILED"),
  failureCode: CodexExecutionFailureCodeSchema,
});

export const CodexExecutionEventSchema = z.discriminatedUnion("eventType", [
  RunStartedEventSchema,
  ItemCompletedEventSchema,
  FinalOutputEventSchema,
  UsageRecordedEventSchema,
  RunCompletedEventSchema,
  RunFailedEventSchema,
]);
export type CodexExecutionEvent = z.infer<typeof CodexExecutionEventSchema>;

export class CodexExecutionError extends Error {
  constructor(readonly code: CodexExecutionFailureCode) {
    super(code);
    this.name = "CodexExecutionError";
  }
}
