// @vitest-environment jsdom

import {
  AgentConversationListSchema,
  ConversationReadModelSchema,
  ConversationSendResponseSchema,
} from "@agent-world/read-model";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ConversationClient, ConversationDrawer } from "./conversation-drawer";

const agentId = "agent_11111111-1111-1111-1111-111111111111";
const conversationId = "conversation_22222222-2222-2222-2222-222222222222";
const index = AgentConversationListSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-13T10:00:00.000Z",
  agent: { agentId, displayName: "Research Lead" },
  conversations: [
    {
      conversationId,
      projectId: "project_33333333-3333-3333-3333-333333333333",
      title: "Protocol review",
      createdAt: "2026-08-13T09:00:00.000Z",
    },
  ],
});
const indexedConversation = index.conversations.at(0);
if (!indexedConversation) throw new Error("Conversation fixture is incomplete");
const conversation = ConversationReadModelSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-13T10:00:00.000Z",
  conversation: indexedConversation,
  agent: { agentId, displayName: "Research Lead", role: "Research", isEnabled: true },
  messages: [],
});

afterEach(cleanup);

describe("ConversationDrawer", () => {
  it("loads a canonical Agent conversation and sends without inventing an Agent reply", async () => {
    const user = userEvent.setup();
    const send = vi.fn<ConversationClient["send"]>(async (input) =>
      ConversationSendResponseSchema.parse({
        schemaVersion: 1,
        outcome: "DISPATCHED",
        message: {
          messageId: input.messageId,
          author: "OWNER",
          content: input.content,
          delivery: "DISPATCHED",
          createdAt: "2026-08-13T10:01:00.000Z",
          provenance: { kind: "DOMAIN" },
        },
      }),
    );
    render(
      <ConversationDrawer
        agent={{ agentId, displayName: "Research Lead" }}
        client={{
          loadIndex: vi.fn(async () => index),
          loadConversation: vi.fn(async () => conversation),
          send,
        }}
        csrfToken="csrf"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Research Lead" })).not.toBeNull();
    await user.type(await screen.findByLabelText("Сообщение"), "Проверь протокол");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Проверь протокол")).not.toBeNull();
    expect(screen.queryByText(/ответ агента/i)).toBeNull();
    expect(send).toHaveBeenCalledOnce();
  });

  it("reuses a stable message id for an exact retry and retains the draft", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const send = vi.fn<ConversationClient["send"]>(async (input) => {
      attempt += 1;
      if (attempt === 1) throw new Error("offline");
      return ConversationSendResponseSchema.parse({
        schemaVersion: 1,
        outcome: "REPLAYED",
        message: {
          messageId: input.messageId,
          author: "OWNER",
          content: input.content,
          delivery: "DISPATCHED",
          createdAt: "2026-08-13T10:01:00.000Z",
          provenance: { kind: "DOMAIN" },
        },
      });
    });
    render(
      <ConversationDrawer
        agent={{ agentId, displayName: "Research Lead" }}
        client={{
          loadIndex: async () => index,
          loadConversation: async () => conversation,
          send,
        }}
        csrfToken="csrf"
        onClose={vi.fn()}
      />,
    );
    const input = await screen.findByLabelText("Сообщение");
    await user.type(input, "Retry me");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect((input as HTMLTextAreaElement).value).toBe("Retry me");
    await user.click(screen.getByRole("button", { name: "Повторить отправку" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[0]?.[0].messageId).toBe(send.mock.calls[1]?.[0].messageId);
  });
});
