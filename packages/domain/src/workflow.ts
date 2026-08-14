import * as z from "zod";
import {
  AccountIdSchema,
  AgentIdSchema,
  ApprovalIdSchema,
  BindingIdSchema,
  ExecutionModeSchema,
  OpaqueExternalIdSchema,
  ProjectIdSchema,
  RouteIdSchema,
  RunIdSchema,
  SessionIdSchema,
  TaskIdSchema,
} from "./identity.js";
import { IdempotencyKeySchema, TimestampSchema } from "./primitives.js";

export const ApprovalRequirementSchema = z.enum(["REQUIRED", "NOT_REQUIRED"]);
export type ApprovalRequirement = z.infer<typeof ApprovalRequirementSchema>;

export const TaskIntentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: TaskIdSchema,
  projectId: ProjectIdSchema,
  assigneeAgentId: AgentIdSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(20_000).optional(),
  approvalRequirement: ApprovalRequirementSchema,
  idempotencyKey: IdempotencyKeySchema,
  createdAt: TimestampSchema,
});
export type TaskIntent = z.infer<typeof TaskIntentSchema>;

const NotRequiredApprovalSchema = z.strictObject({
  type: z.literal("NOT_REQUIRED"),
});

const PendingApprovalSchema = z
  .strictObject({
    type: z.literal("PENDING"),
    approvalId: ApprovalIdSchema,
    requestedAt: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .refine((state) => Date.parse(state.expiresAt) > Date.parse(state.requestedAt), {
    message: "Approval expiry must be after its request",
    path: ["expiresAt"],
  });

const ApprovedApprovalSchema = z.strictObject({
  type: z.literal("APPROVED"),
  approvalId: ApprovalIdSchema,
  decidedAt: TimestampSchema,
});

const DeniedApprovalSchema = z.strictObject({
  type: z.literal("DENIED"),
  approvalId: ApprovalIdSchema,
  decidedAt: TimestampSchema,
  reason: z.string().trim().min(1).max(1_000),
});

const RevokedApprovalSchema = z.strictObject({
  type: z.literal("REVOKED"),
  approvalId: ApprovalIdSchema,
  decidedAt: TimestampSchema,
  reason: z.string().trim().min(1).max(1_000),
});

export const ApprovalStateSchema = z.discriminatedUnion("type", [
  NotRequiredApprovalSchema,
  PendingApprovalSchema,
  ApprovedApprovalSchema,
  DeniedApprovalSchema,
  RevokedApprovalSchema,
]);
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

export const RunStatusSchema = z.enum([
  "DISPATCH_PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

const SharedRunFields = {
  schemaVersion: z.literal(1),
  id: RunIdSchema,
  taskId: TaskIdSchema,
  agentId: AgentIdSchema,
  approvalId: ApprovalIdSchema,
  status: RunStatusSchema,
  attempt: z.number().int().nonnegative().max(10),
  dispatchIdempotencyKey: IdempotencyKeySchema,
  externalRunId: OpaqueExternalIdSchema.optional(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.optional(),
  completedAt: TimestampSchema.optional(),
  failureCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
    .optional(),
};

const RuntimeBoundRunSchema = z.strictObject({
  ...SharedRunFields,
  adapterKind: z.enum(["OPENCLAW", "CODEX", "API_MODEL", "LOCAL_MODEL", "NATIVE_WORK"]),
  bindingId: BindingIdSchema,
  sessionId: SessionIdSchema,
  routeId: z.never().optional(),
  accountId: z.never().optional(),
  executionMode: z.never().optional(),
});

const NativeChatRunSchema = z.strictObject({
  ...SharedRunFields,
  adapterKind: z.literal("NATIVE_CHATGPT"),
  routeId: RouteIdSchema,
  accountId: AccountIdSchema,
  executionMode: ExecutionModeSchema.extract(["CHAT"]),
  bindingId: z.never().optional(),
  sessionId: z.never().optional(),
});

export const RunSchema = z
  .discriminatedUnion("adapterKind", [RuntimeBoundRunSchema, NativeChatRunSchema])
  .superRefine((run, context) => {
    if (run.status === "DISPATCH_PENDING") {
      if (run.externalRunId || run.startedAt || run.completedAt || run.failureCode) {
        context.addIssue({
          code: "custom",
          message: "Pending Runs cannot claim dispatch evidence",
        });
      }
      return;
    }
    if (run.status === "RUNNING") {
      if (!run.externalRunId || !run.startedAt || run.completedAt || run.failureCode) {
        context.addIssue({ code: "custom", message: "Running Runs require exact start evidence" });
      }
      return;
    }
    if (!run.completedAt) {
      context.addIssue({ code: "custom", message: "Terminal Runs require completion evidence" });
    }
    if (run.status === "COMPLETED" && (!run.externalRunId || !run.startedAt || run.failureCode)) {
      context.addIssue({
        code: "custom",
        message: "Completed Runs require successful dispatch evidence",
      });
    }
    if (run.status === "FAILED" && !run.failureCode) {
      context.addIssue({ code: "custom", message: "Failed Runs require a bounded failure code" });
    }
    if (run.status === "CANCELLED" && run.failureCode) {
      context.addIssue({ code: "custom", message: "Cancelled Runs cannot claim failure" });
    }
  });
export type Run = z.infer<typeof RunSchema>;
