import {
  type Agent,
  AgentIdSchema,
  AgentSchema,
  type Conversation,
  type ConversationMessage,
  ConversationMessageSchema,
  ConversationSchema,
  ExecutionAdapterKindSchema,
  MessageContentSchema,
  MessageIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import * as z from "zod";

export const MAX_CONVERSATION_PAGE_MESSAGES = 200;

export const ConversationMessageCursorSchema = z.strictObject({
  createdAt: TimestampSchema,
  messageId: MessageIdSchema,
});
export type ConversationMessageCursor = z.infer<typeof ConversationMessageCursorSchema>;

export const ConversationReadMessageSchema = z.strictObject({
  messageId: MessageIdSchema,
  author: z.enum(["OWNER", "AGENT"]),
  content: z.string().min(1).max(32_000),
  delivery: z.enum(["ACCEPTED", "DISPATCHED", "FAILED", "RECEIVED"]),
  createdAt: TimestampSchema,
  provenance: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("DOMAIN") }),
    z.strictObject({
      kind: z.literal("RUNTIME"),
      adapterKind: ExecutionAdapterKindSchema,
    }),
  ]),
});
export type ConversationReadMessage = z.infer<typeof ConversationReadMessageSchema>;

export const ConversationSendRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  messageId: MessageIdSchema,
  agentId: AgentIdSchema,
  content: MessageContentSchema,
});
export type ConversationSendRequest = z.infer<typeof ConversationSendRequestSchema>;

export const ConversationSendResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(["DISPATCHED", "REPLAYED"]),
  message: ConversationReadMessageSchema,
});
export type ConversationSendResponse = z.infer<typeof ConversationSendResponseSchema>;

export const AgentConversationListSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: TimestampSchema,
  agent: z.strictObject({
    agentId: AgentIdSchema,
    displayName: AgentSchema.shape.displayName,
  }),
  conversations: z
    .array(
      z.strictObject({
        conversationId: ConversationSchema.shape.id,
        projectId: ConversationSchema.shape.projectId,
        title: ConversationSchema.shape.title,
        createdAt: TimestampSchema,
      }),
    )
    .max(100),
});
export type AgentConversationList = z.infer<typeof AgentConversationListSchema>;

export const ConversationReadModelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: TimestampSchema,
  conversation: z.strictObject({
    conversationId: ConversationSchema.shape.id,
    projectId: ConversationSchema.shape.projectId,
    title: ConversationSchema.shape.title,
    createdAt: TimestampSchema,
  }),
  agent: z.strictObject({
    agentId: AgentSchema.shape.id,
    displayName: AgentSchema.shape.displayName,
    role: AgentSchema.shape.role,
    isEnabled: z.boolean(),
  }),
  messages: z.array(ConversationReadMessageSchema).max(MAX_CONVERSATION_PAGE_MESSAGES),
  nextOlderThan: ConversationMessageCursorSchema.optional(),
});
export type ConversationReadModel = z.infer<typeof ConversationReadModelSchema>;

export type ConversationReadModelInput = {
  generatedAt: unknown;
  conversation: unknown;
  agent: unknown;
  messages: unknown;
  hasOlderMessages: boolean;
};

function compareMessages(left: ConversationMessage, right: ConversationMessage): number {
  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)
  );
}

export function projectConversationMessage(messageInput: unknown): ConversationReadMessage {
  const message = ConversationMessageSchema.parse(messageInput);
  return ConversationReadMessageSchema.parse({
    messageId: message.id,
    author: message.author,
    content: message.content,
    delivery: message.delivery,
    createdAt: message.createdAt,
    provenance:
      message.source.kind === "DOMAIN"
        ? { kind: "DOMAIN" }
        : { kind: "RUNTIME", adapterKind: message.source.adapterKind },
  });
}

function assertOwnership(
  conversation: Conversation,
  agent: Agent,
  messages: ConversationMessage[],
): void {
  if (conversation.agentId !== agent.id) {
    throw new Error("Conversation does not belong to the provided Agent");
  }
  const seen = new Set<string>();
  for (const message of messages) {
    if (seen.has(message.id)) {
      throw new Error(`Duplicate Conversation message: ${message.id}`);
    }
    seen.add(message.id);
    if (message.conversationId !== conversation.id) {
      throw new Error(`Message belongs to a different Conversation: ${message.id}`);
    }
    if (message.agentId !== conversation.agentId) {
      throw new Error(`Message belongs to a different Agent: ${message.id}`);
    }
  }
}

export function buildConversationReadModel(
  input: ConversationReadModelInput,
): ConversationReadModel {
  const generatedAt = TimestampSchema.parse(input.generatedAt);
  const conversation = ConversationSchema.parse(input.conversation);
  const agent = AgentSchema.parse(input.agent);
  const messages = z
    .array(ConversationMessageSchema)
    .max(MAX_CONVERSATION_PAGE_MESSAGES)
    .parse(input.messages);
  assertOwnership(conversation, agent, messages);
  const orderedMessages = messages.toSorted(compareMessages);
  if (input.hasOlderMessages && orderedMessages.length === 0) {
    throw new Error("An empty Conversation page cannot advertise older messages");
  }
  const oldest = orderedMessages[0];

  return ConversationReadModelSchema.parse({
    schemaVersion: 1,
    generatedAt,
    conversation: {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      ...(conversation.title === undefined ? {} : { title: conversation.title }),
      createdAt: conversation.createdAt,
    },
    agent: {
      agentId: agent.id,
      displayName: agent.displayName,
      role: agent.role,
      isEnabled: agent.isEnabled,
    },
    messages: orderedMessages.map(projectConversationMessage),
    ...(input.hasOlderMessages && oldest
      ? { nextOlderThan: { createdAt: oldest.createdAt, messageId: oldest.id } }
      : {}),
  });
}
