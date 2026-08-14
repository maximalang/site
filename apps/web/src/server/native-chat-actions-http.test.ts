import { describe, expect, it, vi } from "vitest";
import {
  createNativeChatActionsHandlers,
  nativeChatActionsOpenApi,
} from "./native-chat-actions-http";

const accountId = "account_11111111-1111-1111-1111-111111111111";
const runId = "run_22222222-2222-2222-2222-222222222222";
const resource = "https://world.example/api/mcp";
const issuer = "https://world.example/oauth";

function request(path: string, body: unknown, authorization = "Bearer valid") {
  return new Request(`https://world.example${path}`, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      origin: "https://chatgpt.com",
    },
    body: JSON.stringify(body),
  });
}

describe("Native Chat Actions fallback", () => {
  it("uses the authenticated Account and the canonical append path", async () => {
    const append = vi.fn(async () => ({
      outcome: "APPENDED",
      state: { status: "RUNNING", lastSequence: 1 },
    }));
    const handlers = createNativeChatActionsHandlers({
      resource,
      authorize: async () => ({ accountId, scopes: new Set(["ai_world.run.write"]) }),
      append,
      pull: vi.fn(),
    });

    const response = await handlers.POST(
      request("/api/chat-actions/runs/begin", {
        run_id: runId,
        sequence: 1,
        idempotency_key: "native-chat:begin:1",
      }),
      "begin",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "APPENDED",
      status: "RUNNING",
      last_sequence: 1,
    });
    expect(append).toHaveBeenCalledWith(accountId, {
      schemaVersion: 1,
      runId,
      sequence: 1,
      idempotencyKey: "native-chat:begin:1",
      eventType: "BEGIN_RUN",
      payload: {},
    });
  });

  it("rejects forged Account fields and does not append", async () => {
    const append = vi.fn();
    const handlers = createNativeChatActionsHandlers({
      resource,
      authorize: async () => ({ accountId, scopes: new Set(["ai_world.run.write"]) }),
      append,
      pull: vi.fn(),
    });
    const response = await handlers.POST(
      request("/api/chat-actions/runs/begin", {
        run_id: runId,
        sequence: 1,
        idempotency_key: "native-chat:begin:1",
        account_id: "account_33333333-3333-3333-3333-333333333333",
      }),
      "begin",
    );

    expect(response.status).toBe(400);
    expect(append).not.toHaveBeenCalled();
  });

  it("publishes explicit OAuth operations without an Account input", () => {
    const document = nativeChatActionsOpenApi(resource, issuer);
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths).toHaveProperty("/api/chat-actions/runs/begin");
    expect(document.paths).toHaveProperty("/api/chat-actions/runs/resources");
    expect(document.paths).toHaveProperty("/api/chat-actions/runs/events");
    expect(document.paths).toHaveProperty("/api/chat-actions/runs/commit");
    expect(document.paths).toHaveProperty("/api/chat-actions/runs/fail");
    expect(JSON.stringify(document)).not.toContain("account_id");
    expect(document.components.securitySchemes.oauth.flows.authorizationCode).toEqual({
      authorizationUrl: `${issuer}/auth`,
      tokenUrl: `${issuer}/token`,
      scopes: { "ai_world.run.write": "Read and update assigned AI World Runs" },
    });
  });
});
