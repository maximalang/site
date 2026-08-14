import { describe, expect, it, vi } from "vitest";
import { createNativeChatMcpHandlers } from "./native-chat-mcp-http";

const accountId = "account_11111111-1111-1111-1111-111111111111";
const runId = "run_55555555-5555-5555-5555-555555555555";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://world.example/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("Native Chat MCP HTTP resource server", () => {
  it("challenges unauthenticated requests with exact protected-resource metadata", async () => {
    const handlers = createNativeChatMcpHandlers({
      resource: "https://world.example/api/mcp",
      authorize: async () => undefined,
      append: vi.fn(),
      pull: vi.fn(),
    });
    const response = await handlers.POST(
      request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://world.example/.well-known/oauth-protected-resource/api/mcp", scope="ai_world.run.write"',
    );
  });

  it("lists bounded account-free Control tools for an authenticated principal", async () => {
    const handlers = createNativeChatMcpHandlers({
      resource: "https://world.example/api/mcp",
      authorize: async () => ({ accountId, scopes: new Set(["ai_world.run.write"]) }),
      append: vi.fn(),
      pull: vi.fn(),
    });
    const response = await handlers.POST(
      request(
        { jsonrpc: "2.0", id: "tools", method: "tools/list", params: {} },
        { authorization: "Bearer signed-resource-token", origin: "https://chatgpt.com" },
      ),
    );
    const body = (await response.json()) as { result: { tools: Array<Record<string, unknown>> } };

    expect(response.status).toBe(200);
    expect(body.result.tools.map(({ name }) => name)).toEqual([
      "begin_run",
      "get_run_resources",
      "emit_run_event",
      "commit_result",
      "fail_run",
    ]);
    expect(JSON.stringify(body)).not.toMatch(/account[_A-Z]?id/i);
  });

  it("derives Account from OAuth and commits a structured result without DOM output", async () => {
    const append = vi.fn(async () => ({
      outcome: "APPENDED" as const,
      state: { runId, status: "COMPLETED" as const, lastSequence: 2 },
      occurredAt: "2026-08-14T10:00:00.000Z",
    }));
    const handlers = createNativeChatMcpHandlers({
      resource: "https://world.example/api/mcp",
      authorize: async () => ({ accountId, scopes: new Set(["ai_world.run.write"]) }),
      append,
      pull: vi.fn(),
    });
    const response = await handlers.POST(
      request({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "commit_result",
          arguments: {
            run_id: runId,
            sequence: 2,
            idempotency_key: "native-chat:commit:2",
            structured_result: {
              schemaVersion: 1,
              fullOutput: "Committed through MCP.",
              summary: "Done.",
              findings: [],
              decisions: [],
              actions: [],
              artifacts: [],
              openQuestions: [],
              nextActions: [],
              memoryCandidates: [],
              confidence: 1,
            },
          },
        },
      }),
    );
    const body = (await response.json()) as { result: { structuredContent: unknown } };

    expect(response.status).toBe(200);
    expect(append).toHaveBeenCalledWith(accountId, {
      schemaVersion: 1,
      runId,
      sequence: 2,
      idempotencyKey: "native-chat:commit:2",
      eventType: "COMMIT_RESULT",
      payload: { result: expect.objectContaining({ summary: "Done." }) },
    });
    expect(body.result.structuredContent).toEqual(
      expect.objectContaining({ outcome: "APPENDED", status: "COMPLETED" }),
    );
  });

  it("rejects untrusted origins and any caller-supplied Account identity", async () => {
    const append = vi.fn();
    const handlers = createNativeChatMcpHandlers({
      resource: "https://world.example/api/mcp",
      authorize: async () => ({ accountId, scopes: new Set(["ai_world.run.write"]) }),
      append,
      pull: vi.fn(),
    });
    const hostile = await handlers.POST(
      request(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        { origin: "https://evil.example" },
      ),
    );
    expect(hostile.status).toBe(403);

    const forged = await handlers.POST(
      request({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "begin_run",
          arguments: {
            run_id: runId,
            sequence: 1,
            idempotency_key: "native-chat:begin:1",
            account_id: "account_99999999-9999-9999-9999-999999999999",
          },
        },
      }),
    );
    expect(forged.status).toBe(200);
    expect(await forged.json()).toMatchObject({ error: { code: -32602 } });
    expect(append).not.toHaveBeenCalled();
  });

  it("pulls bounded resources for the OAuth Account without accepting account_id", async () => {
    const pull = vi.fn(async () => ({
      schemaVersion: 1,
      pullId: "resource_pull_11111111-1111-1111-1111-111111111111",
      runId,
      items: [],
      omissions: [{ resource: "MEMORY", reason: "UNAVAILABLE" }],
      estimatedTokens: 0,
      maxTokens: 500,
      pulledAt: "2026-08-14T19:00:00.000Z",
    }));
    const handlers = createNativeChatMcpHandlers({
      resource: "https://world.example/api/mcp",
      authorize: async () => ({ accountId, scopes: new Set(["ai_world.run.write"]) }),
      append: vi.fn(),
      pull,
    });
    const response = await handlers.POST(
      request({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "get_run_resources",
          arguments: {
            run_id: runId,
            resources: ["TASK", "MEMORY"],
            max_items: 10,
            max_tokens: 500,
          },
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(pull).toHaveBeenCalledWith(accountId, {
      schemaVersion: 1,
      runId,
      resources: ["TASK", "MEMORY"],
      maxItems: 10,
      maxTokens: 500,
    });
    expect(await response.json()).toMatchObject({
      result: { structuredContent: { omissions: [{ resource: "MEMORY", reason: "UNAVAILABLE" }] } },
    });
  });
});
