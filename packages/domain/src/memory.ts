import * as z from "zod";
import {
  ContextItemIdSchema,
  EventIdSchema,
  MemoryDecisionIdSchema,
  MemoryProposalIdSchema,
  ProjectIdSchema,
} from "./identity.js";
import { IdempotencyKeySchema, TimestampSchema } from "./primitives.js";

const ContentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const MemoryProposalStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED",
  "MERGED",
  "SUPERSEDED",
  "REJECTED",
]);
export type MemoryProposalStatus = z.infer<typeof MemoryProposalStatusSchema>;

export const MemoryProposalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: MemoryProposalIdSchema,
  projectId: ProjectIdSchema,
  sourceContextItemId: ContextItemIdSchema,
  content: z.string().trim().min(1).max(20_000),
  contentHash: ContentHashSchema,
  estimatedTokens: z.number().int().positive().max(10_000),
  importance: z.number().min(0).max(1),
  status: MemoryProposalStatusSchema,
  createdAt: TimestampSchema,
});
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;

const DecisionBase = {
  schemaVersion: z.literal(1),
  id: MemoryDecisionIdSchema,
  proposalId: MemoryProposalIdSchema,
  projectId: ProjectIdSchema,
  idempotencyKey: IdempotencyKeySchema,
};

export const MemoryCurationDecisionInputSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...DecisionBase, action: z.literal("ACCEPT") }),
  z.strictObject({
    ...DecisionBase,
    action: z.literal("MERGE"),
    targetContextItemId: ContextItemIdSchema,
  }),
  z.strictObject({
    ...DecisionBase,
    action: z.literal("SUPERSEDE"),
    targetContextItemId: ContextItemIdSchema,
  }),
  z.strictObject({ ...DecisionBase, action: z.literal("REJECT") }),
]);
export type MemoryCurationDecisionInput = z.infer<typeof MemoryCurationDecisionInputSchema>;

export const MemoryCurationDecisionSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...DecisionBase, action: z.literal("ACCEPT"), decidedAt: TimestampSchema }),
  z.strictObject({
    ...DecisionBase,
    action: z.literal("MERGE"),
    targetContextItemId: ContextItemIdSchema,
    decidedAt: TimestampSchema,
  }),
  z.strictObject({
    ...DecisionBase,
    action: z.literal("SUPERSEDE"),
    targetContextItemId: ContextItemIdSchema,
    decidedAt: TimestampSchema,
  }),
  z.strictObject({ ...DecisionBase, action: z.literal("REJECT"), decidedAt: TimestampSchema }),
]);
export type MemoryCurationDecision = z.infer<typeof MemoryCurationDecisionSchema>;

const MemoryActionSchema = z.enum(["ACCEPT", "MERGE", "SUPERSEDE", "REJECT"]);

export const MemoryProjectionEventSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sequence: z.number().int().positive(),
    eventId: EventIdSchema,
    eventType: z.enum(["MEMORY_PROPOSED", "MEMORY_CURATED"]),
    projectId: ProjectIdSchema,
    proposalId: MemoryProposalIdSchema,
    decisionId: MemoryDecisionIdSchema.optional(),
    action: MemoryActionSchema.optional(),
    sourceContextItemId: ContextItemIdSchema,
    targetContextItemId: ContextItemIdSchema.optional(),
    materializedContextItemId: ContextItemIdSchema.optional(),
    content: z.string().trim().min(1).max(20_000),
    occurredAt: TimestampSchema,
  })
  .superRefine((event, context) => {
    if (event.eventType === "MEMORY_PROPOSED") {
      if (
        event.decisionId ||
        event.action ||
        event.targetContextItemId ||
        event.materializedContextItemId
      ) {
        context.addIssue({ code: "custom", message: "Proposal event cannot contain a decision" });
      }
      return;
    }
    if (!event.decisionId || !event.action) {
      context.addIssue({ code: "custom", message: "Curated event requires a decision" });
      return;
    }
    if (event.action === "MERGE" || event.action === "SUPERSEDE") {
      if (!event.targetContextItemId) {
        context.addIssue({ code: "custom", message: "Targeted memory action requires a target" });
      }
    } else if (event.targetContextItemId) {
      context.addIssue({
        code: "custom",
        message: "Untargeted memory action cannot contain a target",
      });
    }
    if (event.action !== "REJECT" && !event.materializedContextItemId) {
      context.addIssue({ code: "custom", message: "Accepted memory requires a materialized item" });
    }
    if (event.action === "REJECT" && event.materializedContextItemId) {
      context.addIssue({ code: "custom", message: "Rejected memory cannot materialize context" });
    }
    if (
      event.action === "MERGE" &&
      event.targetContextItemId &&
      event.materializedContextItemId !== event.targetContextItemId
    ) {
      context.addIssue({ code: "custom", message: "Merged memory must materialize as its target" });
    }
    if (
      event.action === "SUPERSEDE" &&
      event.targetContextItemId &&
      event.materializedContextItemId === event.targetContextItemId
    ) {
      context.addIssue({
        code: "custom",
        message: "Superseding memory must replace a distinct target",
      });
    }
  });
export type MemoryProjectionEvent = z.infer<typeof MemoryProjectionEventSchema>;

export const MemoryCurationCandidateSchema = z.strictObject({
  contextItemId: ContextItemIdSchema,
  matchKind: z.literal("EXACT_CONTENT"),
  suggestedAction: z.literal("MERGE"),
  content: z.string().trim().min(1).max(20_000),
  importance: z.number().min(0).max(1),
  createdAt: TimestampSchema,
});
export type MemoryCurationCandidate = z.infer<typeof MemoryCurationCandidateSchema>;

export const MemoryInboxProposalSchema = MemoryProposalSchema.extend({
  curationCandidates: z.array(MemoryCurationCandidateSchema).max(5).default([]),
});
export type MemoryInboxProposal = z.infer<typeof MemoryInboxProposalSchema>;

export const MemoryInboxSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  proposals: z.array(MemoryInboxProposalSchema).max(500),
});
export type MemoryInbox = z.infer<typeof MemoryInboxSchema>;

export const MemoryTimelineEntrySchema = z.strictObject({
  decisionId: MemoryDecisionIdSchema,
  proposalId: MemoryProposalIdSchema,
  action: MemoryActionSchema,
  sourceContextItemId: ContextItemIdSchema,
  targetContextItemId: ContextItemIdSchema.optional(),
  materializedContextItemId: ContextItemIdSchema.optional(),
  content: z.string().trim().min(1).max(20_000),
  decidedAt: TimestampSchema,
});

export const MemoryTimelineSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  entries: z.array(MemoryTimelineEntrySchema).max(500),
});
export type MemoryTimeline = z.infer<typeof MemoryTimelineSchema>;

export const MemoryNetworkNodeSchema = z.strictObject({
  contextItemId: ContextItemIdSchema,
  sourceContextItemId: ContextItemIdSchema,
  content: z.string().trim().min(1).max(20_000),
  importance: z.number().min(0).max(1),
  createdAt: TimestampSchema,
});

export const MemoryNetworkEdgeSchema = z.strictObject({
  decisionId: MemoryDecisionIdSchema,
  sourceContextItemId: ContextItemIdSchema,
  targetContextItemId: ContextItemIdSchema,
  relation: z.enum(["ACCEPTED_FROM", "MERGED_INTO", "SUPERSEDES"]),
  createdAt: TimestampSchema,
});

export const MemoryNetworkSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  nodes: z.array(MemoryNetworkNodeSchema).max(500),
  edges: z.array(MemoryNetworkEdgeSchema).max(1_000),
});
export type MemoryNetwork = z.infer<typeof MemoryNetworkSchema>;

export interface MemoryGraphProjectionPort {
  apply(events: readonly MemoryProjectionEvent[]): Promise<{ appliedThrough: number }>;
}
