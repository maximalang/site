import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import { PostgresRuntimeMessageStore } from "./runtime-message-store.js";

const receivedMessage = {
  externalMessageId: "upstream-message-1",
  content: "Verified answer",
  createdAt: "2026-08-13T05:00:00.000Z",
};

const input = {
  conversationId: "conversation_11111111-1111-1111-1111-111111111111",
  sessionId: "session_22222222-2222-2222-2222-222222222222",
  agentId: "agent_33333333-3333-3333-3333-333333333333",
  bindingId: "binding_44444444-4444-4444-4444-444444444444",
  externalSessionKey: "agent:researcher:main",
  messages: [receivedMessage],
};

const sessionRow = {
  id: input.sessionId,
  conversation_id: input.conversationId,
  agent_id: input.agentId,
  binding_id: input.bindingId,
  external_session_ref: input.externalSessionKey,
};
function pool(rows: unknown[][]) {
  const query = vi.fn();
  for (const result of rows) query.mockResolvedValueOnce({ rows: result });
  const release = vi.fn();
  return {
    query,
    release,
    value: { connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionPool,
  };
}

describe("PostgresRuntimeMessageStore", () => {
  it("persists one canonical Agent message with exact session provenance", async () => {
    const fake = pool([[], [sessionRow], [], [], [], []]);
    const store = new PostgresRuntimeMessageStore(fake.value, {
      messageId: () => "message_55555555-5555-5555-5555-555555555555",
    });
    await expect(store.receiveOpenClawHistory(input)).resolves.toBe(1);
    expect(fake.query.mock.calls.map(([sql]) => String(sql))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("FOR SHARE OF s, b"),
        expect.stringContaining("pg_advisory_xact_lock"),
        expect.stringContaining("INSERT INTO agent_world.conversation_messages"),
      ]),
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("treats an identical upstream replay as an idempotent no-op", async () => {
    const fake = pool([
      [],
      [sessionRow],
      [],
      [
        {
          id: "message_55555555-5555-5555-5555-555555555555",
          conversation_id: input.conversationId,
          session_id: input.sessionId,
          agent_id: input.agentId,
          content: receivedMessage.content,
          created_at: receivedMessage.createdAt,
        },
      ],
      [],
    ]);
    const messageId = vi.fn();
    await expect(
      new PostgresRuntimeMessageStore(fake.value, { messageId }).receiveOpenClawHistory(input),
    ).resolves.toBe(0);
    expect(messageId).not.toHaveBeenCalled();
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO"))).toBe(false);
  });

  it("rolls back a conflicting reuse of an upstream message identity", async () => {
    const fake = pool([
      [],
      [sessionRow],
      [],
      [
        {
          id: "message_55555555-5555-5555-5555-555555555555",
          conversation_id: input.conversationId,
          session_id: input.sessionId,
          agent_id: input.agentId,
          content: "Different answer",
          created_at: receivedMessage.createdAt,
        },
      ],
      [],
    ]);
    await expect(
      new PostgresRuntimeMessageStore(fake.value).receiveOpenClawHistory(input),
    ).rejects.toThrow("conflicts with canonical history");
    expect(fake.query).toHaveBeenLastCalledWith("ROLLBACK");
  });

  it("rejects a history target outside the active canonical session", async () => {
    const fake = pool([[], [], []]);
    await expect(
      new PostgresRuntimeMessageStore(fake.value).receiveOpenClawHistory(input),
    ).rejects.toThrow("active canonical session");
    expect(fake.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
});
