import { ConversationSendError } from "@agent-world/conversation-service";
import { OwnerConversationMessageSchema } from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import { createConversationRouteHandlers } from "./conversation-http";

const conversationId = "conversation_11111111-1111-1111-1111-111111111111";
const agentId = "agent_22222222-2222-2222-2222-222222222222";
const messageId = "message_44444444-4444-4444-4444-444444444444";
const context = { params: Promise.resolve({ conversationId }) };
const readModel = {
  schemaVersion: 1,
  generatedAt: "2026-08-13T10:00:03.000Z",
  conversation: {
    conversationId,
    projectId: "project_33333333-3333-3333-3333-333333333333",
    title: "Protocol review",
    createdAt: "2026-08-13T09:00:00.000Z",
  },
  agent: { agentId, displayName: "Researcher", role: "Protocol verification", isEnabled: true },
  messages: [],
};
const dispatchedMessage = OwnerConversationMessageSchema.parse({
  schemaVersion: 1,
  id: messageId,
  conversationId,
  sessionId: "session_66666666-6666-6666-6666-666666666666",
  agentId,
  author: "OWNER",
  content: "Verify the protocol.",
  delivery: "DISPATCHED",
  createdAt: "2026-08-13T10:00:04.000Z",
  source: {
    kind: "DOMAIN",
    actor: "OWNER",
    commandId: "message:44444444-4444-4444-4444-444444444444",
  },
});

function request(path = `/api/conversations/${conversationId}`, init?: RequestInit): Request {
  return new Request(`https://world.test${path}`, init);
}

function dependencies() {
  return {
    authorize: vi.fn(async () => true),
    read: vi.fn(async () => readModel),
    send: vi.fn(async () => ({ outcome: "DISPATCHED" as const, message: dispatchedMessage })),
    now: () => new Date("2026-08-13T10:00:04.000Z"),
  };
}

describe("conversation HTTP handlers", () => {
  it("authorizes and returns a validated no-store conversation page", async () => {
    const deps = dependencies();
    const { GET } = createConversationRouteHandlers(deps);
    const response = await GET(
      request(
        `${`/api/conversations/${conversationId}`}?limit=50&beforeCreatedAt=2026-08-13T10%3A00%3A00.000Z&beforeMessageId=${messageId}`,
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual(readModel);
    expect(deps.read).toHaveBeenCalledWith({
      conversationId,
      limit: 50,
      olderThan: { createdAt: "2026-08-13T10:00:00.000Z", messageId },
    });
  });

  it("builds server-owned intent fields and returns a redacted dispatch response", async () => {
    const deps = dependencies();
    const { POST } = createConversationRouteHandlers(deps);
    const response = await POST(
      request(`/api/conversations/${conversationId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          origin: "https://world.test",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          messageId,
          agentId,
          content: "Verify the protocol.",
        }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(deps.send).toHaveBeenCalledWith({
      schemaVersion: 1,
      id: messageId,
      conversationId,
      agentId,
      content: "Verify the protocol.",
      idempotencyKey: "message:44444444-4444-4444-4444-444444444444",
      createdAt: "2026-08-13T10:00:04.000Z",
    });
    const serialized = await response.text();
    expect(serialized).toContain('"outcome":"DISPATCHED"');
    expect(serialized).not.toMatch(/session_|commandId|binding_|external/);
  });

  it("fails closed before providers on missing auth, cross-origin and malformed inputs", async () => {
    const cases: Array<{ authorize?: boolean; request: Request }> = [
      { authorize: false, request: request() },
      {
        request: request(undefined, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://evil.test" },
          body: "{}",
        }),
      },
      {
        request: request(undefined, {
          method: "POST",
          headers: { "content-type": "text/plain", origin: "https://world.test" },
          body: "{}",
        }),
      },
    ];

    for (const testCase of cases) {
      const deps = dependencies();
      deps.authorize.mockResolvedValue(testCase.authorize ?? true);
      const { POST } = createConversationRouteHandlers(deps);
      const response = await POST(testCase.request, context);
      expect(response.status).toBe(testCase.authorize === false ? 401 : 400);
      expect(deps.send).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid cursors and oversized or broad JSON bodies", async () => {
    const deps = dependencies();
    const handlers = createConversationRouteHandlers(deps);
    const invalidRead = await handlers.GET(
      request(`/api/conversations/${conversationId}?beforeCreatedAt=2026-08-13T10:00:00.000Z`),
      context,
    );
    const broadPost = await handlers.POST(
      request(undefined, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://world.test" },
        body: JSON.stringify({
          schemaVersion: 1,
          messageId,
          agentId,
          content: "x".repeat(32_001),
          sessionId: "session_66666666-6666-6666-6666-666666666666",
        }),
      }),
      context,
    );

    expect(invalidRead.status).toBe(400);
    expect(broadPost.status).toBe(400);
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("maps bounded domain errors and never reflects provider exceptions", async () => {
    const domainDeps = dependencies();
    domainDeps.send.mockRejectedValue(new ConversationSendError("NO_ACTIVE_SESSION"));
    const providerDeps = dependencies();
    providerDeps.read.mockRejectedValue(new Error("postgres-password-must-not-leak"));
    const body = JSON.stringify({ schemaVersion: 1, messageId, agentId, content: "Verify." });
    const postRequest = () =>
      request(undefined, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://world.test" },
        body,
      });

    const domainResponse = await createConversationRouteHandlers(domainDeps).POST(
      postRequest(),
      context,
    );
    const providerResponse = await createConversationRouteHandlers(providerDeps).GET(
      request(),
      context,
    );
    expect(domainResponse.status).toBe(409);
    expect(await domainResponse.text()).toContain("NO_ACTIVE_SESSION");
    expect(providerResponse.status).toBe(503);
    expect(await providerResponse.text()).not.toContain("postgres-password-must-not-leak");
  });
});
