import { describe, expect, it } from "vitest";
import {
  ConversationMessageSchema,
  ConversationSchema,
  ConversationSessionSchema,
  SendMessageIntentSchema,
} from "./index.js";

const IDS = {
  agent: "agent_11111111-1111-1111-1111-111111111111",
  binding: "binding_22222222-2222-2222-2222-222222222222",
  conversation: "conversation_33333333-3333-3333-3333-333333333333",
  message: "message_44444444-4444-4444-4444-444444444444",
  project: "project_55555555-5555-5555-5555-555555555555",
  session: "session_66666666-6666-6666-6666-666666666666",
} as const;

describe("conversation contracts", () => {
  it("keeps one canonical conversation independent from replaceable runtime sessions", () => {
    const conversation = ConversationSchema.parse({
      schemaVersion: 1,
      id: IDS.conversation,
      agentId: IDS.agent,
      projectId: IDS.project,
      title: "Protocol review",
      createdAt: "2026-08-13T10:00:00.000Z",
    });
    const firstSession = ConversationSessionSchema.parse({
      schemaVersion: 1,
      id: IDS.session,
      conversationId: conversation.id,
      agentId: conversation.agentId,
      bindingId: IDS.binding,
      adapterKind: "OPENCLAW",
      externalSessionRef: "agent:researcher:conversation-33333333",
      startedAt: "2026-08-13T10:00:01.000Z",
    });
    const replacementSession = ConversationSessionSchema.parse({
      ...firstSession,
      id: "session_77777777-7777-7777-7777-777777777777",
      externalSessionRef: "agent:researcher:conversation-33333333-retry",
    });

    expect(firstSession.conversationId).toBe(replacementSession.conversationId);
    expect(firstSession.id).not.toBe(replacementSession.id);
  });

  it("accepts a bounded owner intent without exposing runtime routing fields", () => {
    const intent = SendMessageIntentSchema.parse({
      schemaVersion: 1,
      id: IDS.message,
      conversationId: IDS.conversation,
      agentId: IDS.agent,
      content: "Verify the current protocol contract.",
      idempotencyKey: "message:44444444-4444-4444-4444-444444444444",
      createdAt: "2026-08-13T10:00:02.000Z",
    });

    expect(intent.content).toBe("Verify the current protocol contract.");
    expect(
      SendMessageIntentSchema.safeParse({
        ...intent,
        externalSessionRef: "must-not-cross-boundary",
      }).success,
    ).toBe(false);
    expect(
      SendMessageIntentSchema.safeParse({ ...intent, content: "x".repeat(32_001) }).success,
    ).toBe(false);
  });

  it("requires runtime provenance for Agent output and domain provenance for owner input", () => {
    const owner = ConversationMessageSchema.parse({
      schemaVersion: 1,
      id: IDS.message,
      conversationId: IDS.conversation,
      sessionId: IDS.session,
      agentId: IDS.agent,
      author: "OWNER",
      content: "Verify the current protocol contract.",
      delivery: "DISPATCHED",
      createdAt: "2026-08-13T10:00:02.000Z",
      source: {
        kind: "DOMAIN",
        actor: "OWNER",
        commandId: "message:44444444-4444-4444-4444-444444444444",
      },
    });
    const agent = ConversationMessageSchema.parse({
      schemaVersion: 1,
      id: "message_88888888-8888-8888-8888-888888888888",
      conversationId: IDS.conversation,
      sessionId: IDS.session,
      agentId: IDS.agent,
      author: "AGENT",
      content: "The protocol remains version 4.",
      delivery: "RECEIVED",
      createdAt: "2026-08-13T10:00:03.000Z",
      source: {
        kind: "RUNTIME",
        adapterKind: "OPENCLAW",
        bindingId: IDS.binding,
        externalMessageId: "gateway-message-1",
      },
    });

    expect(owner.author).toBe("OWNER");
    expect(agent.author).toBe("AGENT");
    expect(
      ConversationMessageSchema.safeParse({
        ...agent,
        source: owner.source,
      }).success,
    ).toBe(false);
  });

  it("rejects invalid session lifetimes and unknown session fields", () => {
    expect(
      ConversationSessionSchema.safeParse({
        schemaVersion: 1,
        id: IDS.session,
        conversationId: IDS.conversation,
        agentId: IDS.agent,
        bindingId: IDS.binding,
        adapterKind: "OPENCLAW",
        externalSessionRef: "agent:researcher:main",
        startedAt: "2026-08-13T10:00:02.000Z",
        endedAt: "2026-08-13T10:00:01.000Z",
      }).success,
    ).toBe(false);
  });
});
