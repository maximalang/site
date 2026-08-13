import {
  AgentIdSchema,
  ConversationIdSchema,
  TaskIdSchema,
  TaskIntentSchema,
} from "@agent-world/domain";
import * as z from "zod";

export const TaskAssignmentRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  taskId: TaskIdSchema,
  conversationId: ConversationIdSchema,
  agentId: AgentIdSchema,
  title: TaskIntentSchema.shape.title,
  description: TaskIntentSchema.shape.description,
});
export type TaskAssignmentRequest = z.infer<typeof TaskAssignmentRequestSchema>;

export const TaskAssignmentResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(["CREATED", "REPLAY"]),
  task: z.strictObject({
    ...TaskIntentSchema.shape,
    approvalRequirement: z.literal("REQUIRED"),
  }),
});
export type TaskAssignmentResponse = z.infer<typeof TaskAssignmentResponseSchema>;
