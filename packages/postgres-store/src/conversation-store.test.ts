import {
  ConversationMessageSchema,
  type OwnerConversationMessage,
  SendMessageIntentSchema,
} from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import { PostgresConversationStore, type TransactionPool } from "./conversation-store.js";

const intent = SendMessageIntentSchema.parse({
  schemaVersion: 1,
  id: "message_11111111-1111-1111-1111-111111111111",
  conversationId: "conversation_22222222-2222-2222-2222-222222222222",
  agentId: "agent_33333333-3333-3333-3333-333333333333",
  content: "Verify the protocol.",
  idempotencyKey: "message:11111111-1111-1111-1111-111111111111",
  createdAt: "2026-08-13T10:00:00.000Z",
});

function message(delivery: OwnerConversationMessage["delivery"]): OwnerConversationMessage {
  return ConversationMessageSchema.parse({
    schemaVersion: 1,
    id: intent.id,
    conversationId: intent.conversationId,
    sessionId: "session_44444444-4444-4444-4444-444444444444",
    agentId: intent.agentId,
    author: "OWNER",
    content: intent.content,
    delivery,
    createdAt: intent.createdAt,
    source: { kind: "DOMAIN", actor: "OWNER", commandId: intent.idempotencyKey },
  }) as OwnerConversationMessage;
}

function setup(rows: unknown[][]) {
  const query = vi.fn(async (_text: string, _values?: unknown[]) => ({
    rows: rows.shift() ?? [],
    rowCount: 0,
  }));
  const release = vi.fn();
  const pool: TransactionPool = {
    connect: vi.fn(async () => ({
      query: query as unknown as Awaited<ReturnType<TransactionPool["connect"]>>["query"],
      release,
    })),
  };
  return { pool, query, release, store: new PostgresConversationStore(pool) };
}

describe("PostgresConversationStore", () => {
  it("uses one transaction client, advisory idempotency lock and parameterized values", async () => {
    const { query, release, store } = setup([
      [],
      [],
      [],
      [],
      [
        {
          id: intent.conversationId,
          agent_id: intent.agentId,
          project_id: "project_55555555-5555-5555-5555-555555555555",
          title: "Protocol",
          created_at: "2026-08-13T09:00:00.000Z",
        },
      ],
      [
        {
          id: "session_44444444-4444-4444-4444-444444444444",
          conversation_id: intent.conversationId,
          agent_id: intent.agentId,
          binding_id: "binding_66666666-6666-6666-6666-666666666666",
          adapter_kind: "OPENCLAW",
          external_session_ref: "agent:researcher:protocol",
          started_at: "2026-08-13T09:30:00.000Z",
          ended_at: null,
          route_id: "route_77777777-7777-7777-7777-777777777777",
          external_agent_id: "researcher",
          binding_is_enabled: true,
        },
      ],
      [{}],
    ]);

    const result = await store.prepareSend({
      intent,
      acceptedAt: "2026-08-13T10:00:01.000Z",
    });

    expect(result.kind).toBe("READY");
    expect(query.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(query.mock.calls.slice(1, 3)).toEqual(
      [intent.idempotencyKey, intent.id]
        .toSorted()
        .map((lockKey) => ["SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]]),
    );
    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO agent_world.conversation_messages"),
    );
    expect(insert?.[0]).not.toContain(intent.content);
    expect(insert?.[1]).toContain(intent.content);
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases the client when a query fails", async () => {
    const query = vi
      .fn(async (_text: string, _values?: unknown[]) => ({ rows: [] }))
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("database failure"))
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const pool: TransactionPool = {
      connect: vi.fn(async () => ({
        query: query as unknown as Awaited<ReturnType<TransactionPool["connect"]>>["query"],
        release,
      })),
    };
    const store = new PostgresConversationStore(pool);

    await expect(
      store.prepareSend({ intent, acceptedAt: "2026-08-13T10:00:01.000Z" }),
    ).rejects.toThrow("database failure");
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("maps a stable persisted message for delivery-state updates", async () => {
    const row = {
      id: intent.id,
      conversation_id: intent.conversationId,
      session_id: "session_44444444-4444-4444-4444-444444444444",
      agent_id: intent.agentId,
      author: "OWNER",
      content: intent.content,
      delivery: "DISPATCHED",
      created_at: intent.createdAt,
      command_id: intent.idempotencyKey,
    };
    const { query, store } = setup([[row]]);

    await expect(
      store.markDispatched({
        messageId: intent.id,
        sessionId: message("ACCEPTED").sessionId,
        dispatchedAt: "2026-08-13T10:00:01.000Z",
        receipt: { acceptedAt: "2026-08-13T10:00:01.000Z", externalRequestId: "run-1" },
      }),
    ).resolves.toEqual(message("DISPATCHED"));
    expect(query.mock.calls[0]?.[0]).toContain("UPDATE agent_world.conversation_messages");
    expect(query.mock.calls[0]?.[1]).toContain("run-1");
  });
});
