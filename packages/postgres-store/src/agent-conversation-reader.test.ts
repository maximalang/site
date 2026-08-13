import { describe, expect, it, vi } from "vitest";
import { PostgresAgentConversationReader } from "./agent-conversation-reader.js";
import type { TransactionPool } from "./conversation-store.js";

const agentId = "agent_11111111-1111-1111-1111-111111111111";

function pool(results: unknown[][]) {
  const query = vi.fn();
  for (const rows of results) query.mockResolvedValueOnce({ rows });
  const release = vi.fn();
  return {
    query,
    release,
    value: { connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionPool,
  };
}

describe("PostgresAgentConversationReader", () => {
  it("returns newest canonical Conversations without runtime locators", async () => {
    const fake = pool([
      [{ id: agentId, display_name: "Researcher" }],
      [
        {
          id: "conversation_22222222-2222-2222-2222-222222222222",
          project_id: "project_33333333-3333-3333-3333-333333333333",
          title: "Protocol review",
          created_at: new Date("2026-08-13T09:00:00.000Z"),
        },
      ],
    ]);
    const list = await new PostgresAgentConversationReader(
      fake.value,
      () => new Date("2026-08-13T10:00:00.000Z"),
    ).read(agentId);
    expect(list?.conversations[0]).toEqual({
      conversationId: "conversation_22222222-2222-2222-2222-222222222222",
      projectId: "project_33333333-3333-3333-3333-333333333333",
      title: "Protocol review",
      createdAt: "2026-08-13T09:00:00.000Z",
    });
    expect(JSON.stringify(list)).not.toMatch(/session_|binding_|external/);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("returns undefined without querying Conversations for a missing Agent", async () => {
    const fake = pool([[]]);
    await expect(
      new PostgresAgentConversationReader(fake.value).read(agentId),
    ).resolves.toBeUndefined();
    expect(fake.query).toHaveBeenCalledOnce();
  });
});
