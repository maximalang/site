import {
  AccountIdSchema,
  ApprovalStateSchema,
  ExecutionAdapterKindSchema,
  ExecutionModeSchema,
  ModelRouteIdSchema,
  OpaqueExternalIdSchema,
  RouteIdSchema,
  RunSchema,
  TaskIdSchema,
} from "@agent-world/domain";
import * as z from "zod";

const DecisionIdentity = {
  schemaVersion: z.literal(1),
  taskId: TaskIdSchema,
  decisionId: z.uuid(),
};

export const ApprovalDecisionRequestSchema = z.discriminatedUnion("decision", [
  z.strictObject({ ...DecisionIdentity, decision: z.literal("APPROVE") }),
  z.strictObject({
    ...DecisionIdentity,
    decision: z.literal("DENY"),
    reason: z.string().trim().min(1).max(1_000),
  }),
  z.strictObject({
    ...DecisionIdentity,
    decision: z.literal("REVOKE"),
    reason: z.string().trim().min(1).max(1_000),
  }),
]);
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequestSchema>;

export const ExecutionProvenanceSchema = z.strictObject({
  routeId: RouteIdSchema,
  accountId: AccountIdSchema.optional(),
  mode: ExecutionModeSchema,
  adapterKind: ExecutionAdapterKindSchema,
  modelRouteId: ModelRouteIdSchema.optional(),
  remoteModelId: OpaqueExternalIdSchema.optional(),
});
export type ExecutionProvenance = z.infer<typeof ExecutionProvenanceSchema>;

export const ApprovalDecisionResponseSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    outcome: z.enum(["DECIDED", "REPLAY"]),
    approval: ApprovalStateSchema,
    run: RunSchema.optional(),
    execution: ExecutionProvenanceSchema.optional(),
    dispatch: z.enum(["DISPATCHED", "REPLAYED", "PENDING", "NOT_APPLICABLE"]),
  })
  .refine(
    (response) =>
      response.dispatch === "NOT_APPLICABLE"
        ? response.approval.type !== "APPROVED"
        : response.approval.type === "APPROVED" && response.run !== undefined,
    { message: "Dispatch state must be backed by an approved canonical Run", path: ["dispatch"] },
  );
export type ApprovalDecisionResponse = z.infer<typeof ApprovalDecisionResponseSchema>;
