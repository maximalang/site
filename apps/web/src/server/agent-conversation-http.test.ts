import { AgentConversationListSchema } from "@agent-world/read-model";
import { describe, expect, it, vi } from "vitest";
import { createAgentConversationRouteHandler } from "./agent-conversation-http";

const agentId = "agent_11111111-1111-1111-1111-111111111111";
const list = AgentConversationListSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-13T10:00:00.000Z",
  agent: { agentId, displayName: "Researcher" },
  conversations: [],
});

function request() {
  return new Request("https://agent-world.test/api/agents/example/conversations");
}

function context(value = agentId) {
  return { params: Promise.resolve({ agentId: value }) };
}

describe("createAgentConversationRouteHandler", () => {
  it("authorizes before reading and returns the bounded projection", async () => {
    const authorize = vi.fn(async () => true);
    const read = vi.fn(async () => list);
    const response = await createAgentConversationRouteHandler({ authorize, read })(
      request(),
      context(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(list);
    expect(read).toHaveBeenCalledWith(agentId);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("does not parse or read when authorization fails", async () => {
    const read = vi.fn();
    const response = await createAgentConversationRouteHandler({
      authorize: async () => false,
      read,
    })(request(), context("not-an-agent"));
    expect(response.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it("distinguishes invalid, missing, and unavailable reads", async () => {
    const handler = createAgentConversationRouteHandler({
      authorize: async () => true,
      read: async () => undefined,
    });
    expect((await handler(request(), context("bad"))).status).toBe(400);
    expect((await handler(request(), context())).status).toBe(404);

    const unavailable = createAgentConversationRouteHandler({
      authorize: async () => true,
      read: async () => {
        throw new Error("database unavailable");
      },
    });
    expect((await unavailable(request(), context())).status).toBe(503);
  });
});
