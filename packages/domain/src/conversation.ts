import * as z from "zod";

import {
  AgentIdSchema,
  BindingIdSchema,
  ConversationIdSchema,
  ExecutionAdapterKindSchema,
  MessageIdSchema,
  OpaqueExternalIdSchema,
  ProjectIdSchema,
  SessionIdSchema,
} from "./identity.js";
import { CommandIdSchema, IdempotencyKeySchema, TimestampSchema } from "./primitives.js";

export const MessageContentSchema = z
  .string()
  .min(1)
  .max(32_000)
  .refine((content) => content.trim().length > 0, "Message content must not be blank");

export const ConversationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: ConversationIdSchema,
  agentId: AgentIdSchema,
  projectId: ProjectIdSchema,
  title: z.string().trim().min(1).max(160).optional(),
  createdAt: TimestampSchema,
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const ConversationSessionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: SessionIdSchema,
    conversationId: ConversationIdSchema,
    agentId: AgentIdSchema,
    bindingId: BindingIdSchema,
    adapterKind: ExecutionAdapterKindSchema,
    externalSessionRef: OpaqueExternalIdSchema,
    startedAt: TimestampSchema,
    endedAt: TimestampSchema.optional(),
  })
  .refine(
    ({ endedAt, startedAt }) =>
      endedAt === undefined || Date.parse(endedAt) >= Date.parse(startedAt),
    {
      message: "Session end must not precede its start",
      path: ["endedAt"],
    },
  );
export type ConversationSession = z.infer<typeof ConversationSessionSchema>;

export const SendMessageIntentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: MessageIdSchema,
  conversationId: ConversationIdSchema,
  agentId: AgentIdSchema,
  content: MessageContentSchema,
  idempotencyKey: IdempotencyKeySchema,
  createdAt: TimestampSchema,
});
export type SendMessageIntent = z.infer<typeof SendMessageIntentSchema>;

const MessageBaseShape = {
  schemaVersion: z.literal(1),
  id: MessageIdSchema,
  conversationId: ConversationIdSchema,
  sessionId: SessionIdSchema,
  agentId: AgentIdSchema,
  content: MessageContentSchema,
  createdAt: TimestampSchema,
} as const;

export const OwnerConversationMessageSchema = z.strictObject({
  ...MessageBaseShape,
  author: z.literal("OWNER"),
  delivery: z.enum(["ACCEPTED", "DISPATCHED", "FAILED"]),
  source: z.strictObject({
    kind: z.literal("DOMAIN"),
    actor: z.literal("OWNER"),
    commandId: CommandIdSchema,
  }),
});
export type OwnerConversationMessage = z.infer<typeof OwnerConversationMessageSchema>;

export const AgentConversationMessageSchema = z.strictObject({
  ...MessageBaseShape,
  author: z.literal("AGENT"),
  delivery: z.literal("RECEIVED"),
  source: z.strictObject({
    kind: z.literal("RUNTIME"),
    adapterKind: ExecutionAdapterKindSchema,
    bindingId: BindingIdSchema,
    externalMessageId: OpaqueExternalIdSchema,
  }),
});
export type AgentConversationMessage = z.infer<typeof AgentConversationMessageSchema>;

export const ConversationMessageSchema = z.discriminatedUnion("author", [
  OwnerConversationMessageSchema,
  AgentConversationMessageSchema,
]);
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
