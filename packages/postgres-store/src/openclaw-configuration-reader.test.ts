import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import { PostgresOpenClawConfigurationReader } from "./openclaw-configuration-reader.js";

const agent = {
  id: "agent_11111111-1111-1111-1111-111111111111",
  slug: "researcher",
  display_name: "Researcher",
  role: "Protocol verification",
  instructions: "Verify protocol contracts with evidence.",
  is_enabled: true,
};
const binding = {
  id: "binding_22222222-2222-2222-2222-222222222222",
  agent_id: agent.id,
  external_agent_id: "researcher",
  display_name: agent.display_name,
};
const messageSession = {
  id: "session_33333333-3333-3333-3333-333333333333",
  conversation_id: "conversation_44444444-4444-4444-4444-444444444444",
  agent_id: agent.id,
  binding_id: binding.id,
  external_agent_id: binding.external_agent_id,
  external_session_ref: "agent:researcher:main",
};

function pool(agentRows = [agent], bindingRows = [binding], messageSessionRows = [messageSession]) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: agentRows })
    .mockResolvedValueOnce({ rows: bindingRows })
    .mockResolvedValueOnce({ rows: messageSessionRows });
  const release = vi.fn();
  return {
    query,
    release,
    value: { connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionPool,
  };
}

describe("PostgresOpenClawConfigurationReader", () => {
  it("keeps canonical Agents distinct from runtime bindings", async () => {
    const fake = pool();
    const configuration = await new PostgresOpenClawConfigurationReader(fake.value).read();

    expect(configuration.agents).toEqual([
      {
        schemaVersion: 1,
        id: agent.id,
        slug: agent.slug,
        displayName: agent.display_name,
        role: agent.role,
        instructions: agent.instructions,
        isEnabled: true,
      },
    ]);
    expect(configuration.bindings).toEqual([
      {
        agentId: agent.id,
        bindingId: binding.id,
        externalAgentId: binding.external_agent_id,
        displayName: agent.display_name,
      },
    ]);
    expect(configuration.messageSessions).toEqual([
      {
        conversationId: messageSession.conversation_id,
        sessionId: messageSession.id,
        agentId: agent.id,
        bindingId: binding.id,
        externalAgentId: binding.external_agent_id,
        externalSessionKey: messageSession.external_session_ref,
      },
    ]);
    expect(configuration.agents[0]?.id).not.toBe(configuration.bindings[0]?.bindingId);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("rejects multiple enabled bindings for one canonical Agent", async () => {
    const fake = pool(
      [agent],
      [
        binding,
        {
          ...binding,
          id: "binding_33333333-3333-3333-3333-333333333333",
          external_agent_id: "researcher-secondary",
        },
      ],
    );
    await expect(new PostgresOpenClawConfigurationReader(fake.value).read()).rejects.toThrow(
      "multiple enabled",
    );
  });

  it("rejects unsafe external routing IDs and releases the connection", async () => {
    const fake = pool([agent], [{ ...binding, external_agent_id: "unsafe agent/id" }]);
    await expect(new PostgresOpenClawConfigurationReader(fake.value).read()).rejects.toThrow(
      "safe routing",
    );
    expect(fake.release).toHaveBeenCalledOnce();
  });
});
