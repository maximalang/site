import * as z from "zod";
import { AgentIdSchema, ApprovalIdSchema, ProjectIdSchema, TaskIdSchema } from "./identity.js";
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
