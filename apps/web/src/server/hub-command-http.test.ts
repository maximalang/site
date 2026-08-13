import { HubCommandStoreError } from "@agent-world/postgres-store";
import { describe, expect, it, vi } from "vitest";
import { createHubCommandRouteHandler } from "./hub-command-http";

const body = {
  schemaVersion: 1,
  commandId: "hub_command_11111111-1111-1111-1111-111111111111",
  kind: "PROVIDER_CREATE",
  providerId: "provider_22222222-2222-2222-2222-222222222222",
  slug: "openai",
  displayName: "OpenAI",
  providerKind: "OPENAI",
  category: "LLM_API",
  baseUrl: "https://api.openai.com/v1",
} as const;

function request(input: unknown = body, headers: Record<string, string> = {}) {
  return new Request("https://world.test/api/hub/commands", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://world.test",
      ...headers,
    },
    body: JSON.stringify(input),
  });
}

describe("Hub command HTTP", () => {
  it.each([
    ["CREATED", 201],
    ["REPLAY", 200],
  ] as const)("returns a bounded %s receipt", async (outcome, status) => {
    const execute = vi.fn(async (command) => ({
      schemaVersion: 1,
      outcome,
      commandId: command.commandId,
      resource: { kind: "PROVIDER", id: command.providerId },
    }));
    const response = await createHubCommandRouteHandler({
      authorize: async () => true,
      execute,
    })(request());

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual(expect.objectContaining({ outcome }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ kind: "PROVIDER_CREATE" }));
  });

  it("authorizes before parsing or executing the mutation", async () => {
    const execute = vi.fn();
    const response = await createHubCommandRouteHandler({
      authorize: async () => false,
      execute,
    })(request({ apiKey: "must-not-be-reflected" }));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("apiKey");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects cross-origin, malformed, oversized, and credential-bearing requests", async () => {
    const dependencies = { authorize: async () => true, execute: vi.fn() };
    const cases = [
      request(body, { Origin: "https://attacker.test" }),
      request({ ...body, displayName: "" }),
      request({ ...body, apiKey: "must-not-cross-the-boundary" }),
      request(body, { "Content-Length": "999999" }),
      new Request("https://world.test/api/hub/commands", {
        method: "POST",
        headers: { "Content-Type": "text/plain", Origin: "https://world.test" },
        body: JSON.stringify(body),
      }),
    ];
    for (const input of cases) {
      const response = await createHubCommandRouteHandler(dependencies)(input);
      expect(response.status).toBe(400);
      expect(await response.text()).not.toMatch(/attacker|apiKey|must-not/);
    }
    expect(dependencies.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["IDEMPOTENCY_CONFLICT", 409],
    ["RESOURCE_CONFLICT", 409],
    ["INVALID_REFERENCE", 422],
  ] as const)("maps %s to a bounded response", async (code, status) => {
    const response = await createHubCommandRouteHandler({
      authorize: async () => true,
      execute: async () => {
        throw new HubCommandStoreError(code);
      },
    })(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
  });

  it("fails closed when the command store is unavailable", async () => {
    const response = await createHubCommandRouteHandler({
      authorize: async () => true,
      execute: async () => {
        throw new Error("database-password-must-not-leak");
      },
    })(request());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":{"code":"HUB_COMMAND_UNAVAILABLE"}}');
  });
});
