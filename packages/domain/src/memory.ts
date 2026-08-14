import * as z from "zod";
import {
  ContextItemIdSchema,
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
