import { ConversationIdSchema, MessageIdSchema } from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import { PostgresConversationReader } from "./conversation-reader.js";
import type { TransactionPool } from "./conversation-store.js";

const conversationId = ConversationIdSchema.parse(
  "conversation_11111111-1111-1111-1111-111111111111",
);

function setup(rows: unknown[][]) {
  const query = vi.fn(async (_text: string, _values?: unknown[]) => ({
    rows: rows.shift() ?? [],
  }));
  const release = vi.fn();
  const pool: TransactionPool = {
    connect: vi.fn(async () => ({
      query: query as unknown as Awaited<ReturnType<TransactionPool["connect"]>>["query"],
      release,
    })),
  };
  return {
    query,
    reader: new PostgresConversationReader(pool, {
      now: () => new Date("2026-08-13T10:00:03.000Z"),
    }),
    release,
  };
}

const headerRow = {
  conversation_id: conversationId,
  project_id: "project_22222222-2222-2222-2222-222222222222",
  conversation_title: "Protocol review",
  conversation_created_at: "2026-08-13T09:00:00.000Z",
  agent_id: "agent_33333333-3333-3333-3333-333333333333",
  agent_slug: "researcher",
  agent_display_name: "Researcher",
  agent_role: "Protocol verification",
  agent_instructions: "Verify protocol contracts with evidence.",
  agent_is_enabled: true,
};

const ownerRow = {
  id: "message_44444444-4444-4444-4444-444444444444",
  conversation_id: conversationId,
  session_id: "session_55555555-5555-5555-5555-555555555555",
  agent_id: headerRow.agent_id,
  author: "OWNER",
  content: "Verify the protocol.",
  delivery: "DISPATCHED",
  created_at: "2026-08-13T10:00:01.000Z",
  source_kind: "DOMAIN",
  command_id: "message:44444444-4444-4444-4444-444444444444",
  adapter_kind: null,
  binding_id: null,
  external_message_id: null,
};

describe("PostgresConversationReader", () => {
  it("loads a safe bounded page with a parameterized keyset cursor", async () => {
    const sentinel = {
      ...ownerRow,
      id: "message_66666666-6666-6666-6666-666666666666",
      created_at: "2026-08-13T09:59:59.000Z",
      command_id: "message:66666666-6666-6666-6666-666666666666",
    };
    const { query, reader, release } = setup([[headerRow], [ownerRow, sentinel]]);

    const model = await reader.read({
      conversationId,
      olderThan: {
        createdAt: "2026-08-13T10:00:02.000Z",
        messageId: MessageIdSchema.parse("message_77777777-7777-7777-7777-777777777777"),
      },
      limit: 1,
    });

    expect(model?.messages).toHaveLength(1);
    expect(model?.nextOlderThan).toEqual({
      createdAt: ownerRow.created_at,
      messageId: ownerRow.id,
    });
    expect(query.mock.calls[1]?.[0]).toContain("(created_at, id) < ($2::timestamptz, $3)");
    expect(query.mock.calls[1]?.[1]).toEqual([
      conversationId,
      "2026-08-13T10:00:02.000Z",
      "message_77777777-7777-7777-7777-777777777777",
      2,
    ]);
    expect(JSON.stringify(model)).not.toContain("session_");
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns undefined for a missing Conversation without querying messages", async () => {
    const { query, reader } = setup([[]]);

    await expect(reader.read({ conversationId })).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([0, 201, 1.5])("rejects an invalid page limit %s before querying", async (limit) => {
    const { query, reader } = setup([]);

    await expect(reader.read({ conversationId, limit })).rejects.toThrow("limit");
    expect(query).not.toHaveBeenCalled();
  });
});
