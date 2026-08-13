import type { AgentId, ConversationId, MessageId, SessionId } from "./index.js";

declare const agentId: AgentId;
declare const conversationId: ConversationId;
declare const messageId: MessageId;
declare const sessionId: SessionId;

const validAgent: AgentId = agentId;
const validConversation: ConversationId = conversationId;
const validMessage: MessageId = messageId;
const validSession: SessionId = sessionId;

// @ts-expect-error A runtime Session is not an Agent.
const agentFromSession: AgentId = sessionId;
// @ts-expect-error A Conversation is not a runtime Session.
const sessionFromConversation: SessionId = conversationId;
// @ts-expect-error A Message cannot identify its Conversation.
const conversationFromMessage: ConversationId = messageId;

void [
  validAgent,
  validConversation,
  validMessage,
  validSession,
  agentFromSession,
  sessionFromConversation,
  conversationFromMessage,
];
