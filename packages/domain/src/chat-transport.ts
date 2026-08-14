import * as z from "zod";
import { StructuredAgentOutputSchema } from "./context.js";
import {
  AccountIdSchema,
  AgentIdSchema,
  ArtifactIdSchema,
  ChatDispatchIdSchema,
  LauncherIdSchema,
  RouteIdSchema,
  RunIdSchema,
  TaskIdSchema,
} from "./identity.js";
import { IdempotencyKeySchema, TimestampSchema } from "./primitives.js";

export const TransportDispatchModeSchema = z.enum([
  "BROWSER_ON_DEMAND",
  "SERVER_API",
  "LOCAL_PROCESS",
]);
export type TransportDispatchMode = z.infer<typeof TransportDispatchModeSchema>;

export const TransportResultChannelSchema = z.enum(["CONTROL_API", "SERVER_API", "PROCESS_IO"]);
export type TransportResultChannel = z.infer<typeof TransportResultChannelSchema>;

export const NativeChatLaunchMessageSchema = z.strictObject({ runId: RunIdSchema });
export type NativeChatLaunchMessage = z.infer<typeof NativeChatLaunchMessageSchema>;

export const BrowserProfileRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

export const NativeChatLaunchClaimSchema = z.strictObject({
  schemaVersion: z.literal(1),
  dispatchId: ChatDispatchIdSchema,
  message: NativeChatLaunchMessageSchema,
  accountId: AccountIdSchema,
  profileRef: BrowserProfileRefSchema,
  launcherId: LauncherIdSchema,
  attempt: z.number().int().min(1).max(10),
  leaseExpiresAt: TimestampSchema,
});
export type NativeChatLaunchClaim = z.infer<typeof NativeChatLaunchClaimSchema>;

export const NativeChatSubmissionReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  dispatchId: ChatDispatchIdSchema,
  runId: RunIdSchema,
  accountId: AccountIdSchema,
  profileRef: BrowserProfileRefSchema,
  launcherId: LauncherIdSchema,
  attempt: z.number().int().min(1).max(10),
  submittedAt: TimestampSchema,
  receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type NativeChatSubmissionReceipt = z.infer<typeof NativeChatSubmissionReceiptSchema>;

export const NativeChatDispatchStateSchema = z.enum([
  "QUEUED",
  "BROWSER_SUBMITTED",
  "ATTACHED",
  "FAILED",
]);

export const NativeChatDispatchSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: ChatDispatchIdSchema,
    runId: RunIdSchema,
    taskId: TaskIdSchema,
    agentId: AgentIdSchema,
    accountId: AccountIdSchema,
    routeId: RouteIdSchema,
    state: NativeChatDispatchStateSchema,
    createdAt: TimestampSchema,
    submittedAt: TimestampSchema.optional(),
    attachedAt: TimestampSchema.optional(),
    failedAt: TimestampSchema.optional(),
    failureCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .optional(),
  })
  .superRefine((dispatch, context) => {
    const submitted = dispatch.submittedAt !== undefined;
    const attached = dispatch.attachedAt !== undefined;
    const failed = dispatch.failedAt !== undefined || dispatch.failureCode !== undefined;
    if (dispatch.state === "QUEUED" && (submitted || attached || failed)) {
      context.addIssue({ code: "custom", message: "Queued dispatch cannot claim later evidence" });
    }
    if (dispatch.state === "BROWSER_SUBMITTED" && (!submitted || attached || failed)) {
      context.addIssue({
        code: "custom",
        message: "Submitted dispatch requires only submit evidence",
      });
    }
    if (dispatch.state === "ATTACHED" && (!submitted || !attached || failed)) {
      context.addIssue({
        code: "custom",
        message: "Attached dispatch requires submit and attach evidence",
      });
    }
    if (dispatch.state === "FAILED" && (!dispatch.failedAt || !dispatch.failureCode || attached)) {
      context.addIssue({
        code: "custom",
        message: "Failed dispatch requires bounded failure evidence",
      });
    }
  });
export type NativeChatDispatch = z.infer<typeof NativeChatDispatchSchema>;

export const NativeChatResourceKindSchema = z.enum([
  "TASK",
  "PROJECT_STATE",
  "MEMORY",
  "RAG",
  "SKILLS",
  "ARTIFACTS",
  "ACTION_HISTORY",
]);

export const NativeChatPullRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    runId: RunIdSchema,
    resources: z.array(NativeChatResourceKindSchema).min(1).max(7),
    query: z.string().trim().min(1).max(2_000).optional(),
    maxItems: z.number().int().min(1).max(100),
    maxTokens: z.number().int().min(64).max(100_000),
  })
  .refine((request) => new Set(request.resources).size === request.resources.length, {
    message: "Native Chat pull resources must be unique",
    path: ["resources"],
  });
export type NativeChatPullRequest = z.infer<typeof NativeChatPullRequestSchema>;

export const NativeChatPullProvenanceSchema = z.strictObject({
  source: z.literal("CANONICAL_POSTGRES"),
  entityType: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  entityId: z.string().trim().min(1).max(512),
  recordedAt: TimestampSchema,
});

export const NativeChatPullItemSchema = z.strictObject({
  resource: NativeChatResourceKindSchema,
  content: z.string().trim().min(1).max(200_000),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  estimatedTokens: z.number().int().positive().max(100_000),
  provenance: z.array(NativeChatPullProvenanceSchema).min(1).max(100),
});

export const NativeChatPullOmissionSchema = z.strictObject({
  resource: NativeChatResourceKindSchema,
  reason: z.enum(["UNAVAILABLE", "NO_MATCH", "ITEM_LIMIT", "TOKEN_BUDGET"]),
});

export const NativeChatPullResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  pullId: z
    .string()
    .regex(/^resource_pull_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  runId: RunIdSchema,
  items: z.array(NativeChatPullItemSchema).max(100),
  omissions: z.array(NativeChatPullOmissionSchema).max(7),
  estimatedTokens: z.number().int().nonnegative().max(100_000),
  maxTokens: z.number().int().min(64).max(100_000),
  pulledAt: TimestampSchema,
});
export type NativeChatPullResponse = z.infer<typeof NativeChatPullResponseSchema>;

const ControlEnvelope = {
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  sequence: z.number().int().positive(),
  idempotencyKey: IdempotencyKeySchema,
};

const BeginRunEventSchema = z.strictObject({
  ...ControlEnvelope,
  eventType: z.literal("BEGIN_RUN"),
  payload: z.strictObject({}),
});
const HeartbeatEventSchema = z.strictObject({
  ...ControlEnvelope,
  eventType: z.literal("HEARTBEAT"),
  payload: z.strictObject({ progress: z.string().trim().min(1).max(2_000) }),
});
const FindingEventSchema = z.strictObject({
  ...ControlEnvelope,
  eventType: z.literal("FINDING"),
  payload: z.strictObject({
    statement: z.string().trim().min(1).max(8_000),
    confidence: z.number().min(0).max(1),
  }),
});
const ArtifactEventSchema = z.strictObject({
  ...ControlEnvelope,
  eventType: z.literal("ARTIFACT"),
  payload: z.strictObject({
    artifactId: ArtifactIdSchema,
    note: z.string().trim().min(1).max(2_000).optional(),
  }),
});
const DecisionEventSchema = z.strictObject({
  ...ControlEnvelope,
  eventType: z.literal("DECISION"),
  payload: z.strictObject({
    decision: z.string().trim().min(1).max(8_000),
    rationale: z.string().trim().min(1).max(8_000),
  }),
});
const HandoffEventSchema = z.strictObject({
  ...ControlEnvelope,
  eventType: z.literal("HANDOFF"),
  payload: z.strictObject({
    targetAgentId: AgentIdSchema,
    summary: z.string().trim().min(1).max(20_000),
  }),
});
const FailEventSchema = z.strictObject({
  ...ControlEnvelope,
  eventType: z.literal("FAIL"),
  payload: z.strictObject({
    failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    message: z.string().trim().min(1).max(8_000),
    retryable: z.boolean(),
  }),
});
const CommitResultEventSchema = z.strictObject({
  ...ControlEnvelope,
  eventType: z.literal("COMMIT_RESULT"),
  payload: z.strictObject({ result: StructuredAgentOutputSchema }),
});

export const NativeChatControlEventInputSchema = z.discriminatedUnion("eventType", [
  BeginRunEventSchema,
  HeartbeatEventSchema,
  FindingEventSchema,
  ArtifactEventSchema,
  DecisionEventSchema,
  HandoffEventSchema,
  FailEventSchema,
  CommitResultEventSchema,
]);
export type NativeChatControlEventInput = z.infer<typeof NativeChatControlEventInputSchema>;

export const NativeChatRunControlStateSchema = z.strictObject({
  runId: RunIdSchema,
  status: z.enum(["AWAITING_BEGIN", "RUNNING", "COMPLETED", "FAILED"]),
  lastSequence: z.number().int().nonnegative(),
});
export type NativeChatRunControlState = z.infer<typeof NativeChatRunControlStateSchema>;

export function initialNativeChatRunControlState(runId: string) {
  return NativeChatRunControlStateSchema.parse({
    runId,
    status: "AWAITING_BEGIN",
    lastSequence: 0,
  });
}

export function applyNativeChatControlEvent(
  current: NativeChatRunControlState,
  input: NativeChatControlEventInput,
): NativeChatRunControlState {
  const state = NativeChatRunControlStateSchema.parse(current);
  const event = NativeChatControlEventInputSchema.parse(input);
  if (event.runId !== state.runId) throw new Error("Control event Run does not match state");
  if (state.status === "COMPLETED" || state.status === "FAILED") {
    throw new Error("Control event cannot be appended after terminal state");
  }
  if (event.sequence !== state.lastSequence + 1)
    throw new Error("Control event sequence is not contiguous");
  if (state.status === "AWAITING_BEGIN" && event.eventType !== "BEGIN_RUN") {
    throw new Error("begin_run is required before other Control events");
  }
  if (state.status === "RUNNING" && event.eventType === "BEGIN_RUN") {
    throw new Error("begin_run cannot be repeated");
  }

  const status =
    event.eventType === "COMMIT_RESULT"
      ? "COMPLETED"
      : event.eventType === "FAIL"
        ? "FAILED"
        : "RUNNING";
  return NativeChatRunControlStateSchema.parse({
    runId: state.runId,
    status,
    lastSequence: event.sequence,
  });
}
