import { describe, expect, it, vi } from "vitest";
import {
  loadAgentConversations,
  loadConversation,
  sendConversationMessage,
} from "./conversation-api";

const agentId = "agent_11111111-1111-1111-1111-111111111111";
const conversationId = "conversation_22222222-2222-2222-2222-222222222222";
const messageId = "message_33333333-3333-3333-3333-333333333333";
const list = {
  schemaVersion: 1 as const,
  generatedAt: "2026-08-13T10:00:00.000Z",
  agent: { agentId, displayName: "Researcher" },
  conversations: [],
};

describe("conversation client", () => {
  it("loads the safe Agent index and a canonical Conversation", async () => {
    const fetcher = vi.fn(async () => Response.json(list));
    await expect(loadAgentConversations(agentId, fetcher)).resolves.toEqual(list);
    expect(fetcher).toHaveBeenCalledWith(`/api/agents/${agentId}/conversations`, {
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
    });

    const conversation = {
      schemaVersion: 1 as const,
      generatedAt: "2026-08-13T10:00:00.000Z",
      conversation: {
        conversationId,
        projectId: "project_44444444-4444-4444-4444-444444444444",
        createdAt: "2026-08-13T09:00:00.000Z",
      },
      agent: { agentId, displayName: "Researcher", role: "Research", isEnabled: true },
      messages: [],
    };
    await expect(
      loadConversation(conversationId, async () => Response.json(conversation)),
    ).resolves.toEqual(conversation);
  });

  it("sends a caller-owned idempotent message with in-memory CSRF", async () => {
    const result = {
      schemaVersion: 1 as const,
      outcome: "DISPATCHED" as const,
      message: {
        messageId,
        author: "OWNER" as const,
        content: "Review protocol",
        delivery: "DISPATCHED" as const,
        createdAt: "2026-08-13T10:00:00.000Z",
        provenance: { kind: "DOMAIN" as const },
      },
    };
    const fetcher = vi.fn(async () => Response.json(result));
    await expect(
      sendConversationMessage(
        { conversationId, agentId, messageId, content: "Review protocol", csrfToken: "csrf" },
        fetcher,
      ),
    ).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith(`/api/conversations/${conversationId}`, {
      body: JSON.stringify({ schemaVersion: 1, messageId, agentId, content: "Review protocol" }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Agent-World-CSRF": "csrf" },
      method: "POST",
    });
  });
});
