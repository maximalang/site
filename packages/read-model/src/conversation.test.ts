import { describe, expect, it } from "vitest";
import {
  buildConversationReadModel,
  type ConversationReadModelInput,
  ConversationReadModelSchema,
} from "./conversation.js";

const messages = [
  {
    schemaVersion: 1,
    id: "message_55555555-5555-5555-5555-555555555555",
    conversationId: "conversation_11111111-1111-1111-1111-111111111111",
    sessionId: "session_66666666-6666-6666-6666-666666666666",
    agentId: "agent_22222222-2222-2222-2222-222222222222",
    author: "AGENT",
    content: "The protocol remains version 4.",
    delivery: "RECEIVED",
    createdAt: "2026-08-13T10:00:02.000Z",
    source: {
      kind: "RUNTIME",
      adapterKind: "OPENCLAW",
      bindingId: "binding_77777777-7777-7777-7777-777777777777",
      externalMessageId: "gateway-message-secret-locator",
    },
  },
  {
    schemaVersion: 1,
    id: "message_44444444-4444-4444-4444-444444444444",
    conversationId: "conversation_11111111-1111-1111-1111-111111111111",
    sessionId: "session_66666666-6666-6666-6666-666666666666",
    agentId: "agent_22222222-2222-2222-2222-222222222222",
    author: "OWNER",
    content: "Verify the protocol.",
    delivery: "DISPATCHED",
    createdAt: "2026-08-13T10:00:01.000Z",
    source: {
      kind: "DOMAIN",
      actor: "OWNER",
      commandId: "message:44444444-4444-4444-4444-444444444444",
    },
  },
] as const;

const input: ConversationReadModelInput = {
  generatedAt: "2026-08-13T10:00:03.000Z",
  conversation: {
    schemaVersion: 1,
    id: "conversation_11111111-1111-1111-1111-111111111111",
    agentId: "agent_22222222-2222-2222-2222-222222222222",
    projectId: "project_33333333-3333-3333-3333-333333333333",
    title: "Protocol review",
    createdAt: "2026-08-13T09:00:00.000Z",
  },
  agent: {
    schemaVersion: 1,
    id: "agent_22222222-2222-2222-2222-222222222222",
    slug: "researcher",
    displayName: "Researcher",
    role: "Protocol verification",
    instructions: "Verify protocol contracts with evidence.",
    isEnabled: true,
  },
  messages,
  hasOlderMessages: true,
};

describe("buildConversationReadModel", () => {
  it("projects a deterministic chronological page without runtime locators", () => {
    const model = buildConversationReadModel(input);

    expect(ConversationReadModelSchema.parse(model)).toEqual(model);
    expect(model.messages.map(({ messageId }) => messageId)).toEqual([
      "message_44444444-4444-4444-4444-444444444444",
      "message_55555555-5555-5555-5555-555555555555",
    ]);
    expect(model.nextOlderThan).toEqual({
      createdAt: "2026-08-13T10:00:01.000Z",
      messageId: "message_44444444-4444-4444-4444-444444444444",
    });
    expect(model.messages[0]?.provenance).toEqual({ kind: "DOMAIN" });
    expect(model.messages[1]?.provenance).toEqual({
      kind: "RUNTIME",
      adapterKind: "OPENCLAW",
    });
    const serialized = JSON.stringify(model);
    expect(serialized).not.toContain("session_");
    expect(serialized).not.toContain("binding_");
    expect(serialized).not.toContain("gateway-message-secret-locator");
    expect(serialized).not.toContain("instructions");
  });

  it("rejects cross-conversation messages, duplicate IDs and oversized pages", () => {
    expect(() =>
      buildConversationReadModel({
        ...input,
        messages: [
          {
            ...messages[0],
            conversationId: "conversation_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          },
        ],
      }),
    ).toThrow("Conversation");
    expect(() =>
      buildConversationReadModel({
        ...input,
        messages: [messages[0], messages[0]],
      }),
    ).toThrow("Duplicate");
    expect(() =>
      buildConversationReadModel({
        ...input,
        messages: Array.from({ length: 201 }, (_, index) => ({
          ...messages[0],
          id: `message_${index.toString(16).padStart(8, "0")}-5555-5555-5555-555555555555`,
        })),
      }),
    ).toThrow();
  });

  it("omits an older-page cursor when the page is complete or empty", () => {
    expect(buildConversationReadModel({ ...input, hasOlderMessages: false })).not.toHaveProperty(
      "nextOlderThan",
    );
    expect(
      buildConversationReadModel({ ...input, messages: [], hasOlderMessages: false }),
    ).not.toHaveProperty("nextOlderThan");
    expect(() =>
      buildConversationReadModel({ ...input, messages: [], hasOlderMessages: true }),
    ).toThrow("cannot advertise older messages");
  });
});
