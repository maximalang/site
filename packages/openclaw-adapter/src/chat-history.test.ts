import { describe, expect, it } from "vitest";
import { normalizeOpenClawChatHistory } from "./chat-history.js";

describe("normalizeOpenClawChatHistory", () => {
  it("keeps only bounded visible assistant text with durable upstream identity", () => {
    const messages = normalizeOpenClawChatHistory({
      messages: [
        {
          role: "user",
          content: "owner command",
          __openclaw: { id: "user-1", recordTimestampMs: 1_786_597_100_000 },
        },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private reasoning" },
            { type: "text", text: "  Проверка завершена.  " },
            { type: "toolResult", content: "secret tool output" },
          ],
          __openclaw: { id: "assistant-1", recordTimestampMs: 1_786_597_200_000 },
        },
      ],
    });

    expect(messages).toEqual([
      {
        externalMessageId: "assistant-1",
        content: "Проверка завершена.",
        createdAt: "2026-08-13T05:00:00.000Z",
      },
    ]);
  });

  it("ignores rows without authoritative identity, timestamp, or visible text", () => {
    expect(
      normalizeOpenClawChatHistory({
        messages: [
          { role: "assistant", content: "missing metadata" },
          {
            role: "assistant",
            content: [{ type: "thinking", thinking: "hidden" }],
            __openclaw: { id: "assistant-2", recordTimestampMs: 1_786_597_200_000 },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("deduplicates identical replay and rejects conflicting upstream identities", () => {
    const message = {
      role: "assistant",
      content: "Stable reply",
      __openclaw: { id: "assistant-3", recordTimestampMs: 1_786_597_200_000 },
    };
    expect(normalizeOpenClawChatHistory({ messages: [message, message] })).toHaveLength(1);
    expect(() =>
      normalizeOpenClawChatHistory({
        messages: [message, { ...message, content: "Changed reply" }],
      }),
    ).toThrow("conflicting content");
  });

  it("rejects oversized history envelopes", () => {
    expect(() => normalizeOpenClawChatHistory({ messages: Array(201).fill(null) })).toThrow();
  });
});
