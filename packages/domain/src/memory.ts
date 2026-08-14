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

export const MemoryProposalStatusSchema = z.enum(["PENDING", "ACCEPTED", "MERGED", "REJECTED"]);
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
  decidedAt: TimestampSchema,
};

export const MemoryCurationDecisionSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...DecisionBase, action: z.literal("ACCEPT") }),
  z.strictObject({
    ...DecisionBase,
    action: z.literal("MERGE"),
    targetContextItemId: ContextItemIdSchema,
  }),
  z.strictObject({ ...DecisionBase, action: z.literal("REJECT") }),
]);
export type MemoryCurationDecision = z.infer<typeof MemoryCurationDecisionSchema>;

export const MemoryProjectionEventSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sequence: z.number().int().positive(),
    eventId: EventIdSchema,
    eventType: z.enum(["MEMORY_PROPOSED", "MEMORY_CURATED"]),
    projectId: ProjectIdSchema,
    proposalId: MemoryProposalIdSchema,
    decisionId: MemoryDecisionIdSchema.optional(),
    action: z.enum(["ACCEPT", "MERGE", "REJECT"]).optional(),
    sourceContextItemId: ContextItemIdSchema,
    materializedContextItemId: ContextItemIdSchema.optional(),
    content: z.string().trim().min(1).max(20_000),
    occurredAt: TimestampSchema,
  })
  .superRefine((event, context) => {
    if (event.eventType === "MEMORY_PROPOSED") {
      if (event.decisionId || event.action || event.materializedContextItemId) {
        context.addIssue({ code: "custom", message: "Proposal event cannot contain a decision" });
      }
      return;
    }
    if (!event.decisionId || !event.action) {
      context.addIssue({ code: "custom", message: "Curated event requires a decision" });
    }
    if (event.action !== "REJECT" && !event.materializedContextItemId) {
      context.addIssue({ code: "custom", message: "Accepted memory requires a materialized item" });
    }
    if (event.action === "REJECT" && event.materializedContextItemId) {
      context.addIssue({ code: "custom", message: "Rejected memory cannot materialize context" });
    }
  });
export type MemoryProjectionEvent = z.infer<typeof MemoryProjectionEventSchema>;

export const MemoryInboxSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  proposals: z.array(MemoryProposalSchema).max(500),
});
export type MemoryInbox = z.infer<typeof MemoryInboxSchema>;

export const MemoryTimelineEntrySchema = z.strictObject({
  decisionId: MemoryDecisionIdSchema,
  proposalId: MemoryProposalIdSchema,
  action: z.enum(["ACCEPT", "MERGE", "REJECT"]),
  sourceContextItemId: ContextItemIdSchema,
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
  relation: z.enum(["ACCEPTED_FROM", "MERGED_INTO"]),
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
