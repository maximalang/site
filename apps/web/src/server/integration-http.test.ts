import { describe, expect, it, vi } from "vitest";
import { createIntegrationRouteHandlers } from "./integration-http";

const registry = {
  schemaVersion: 1 as const,
  generatedAt: "2026-08-15T12:00:00.000Z",
  integrations: [],
};
const create = {
  id: "integration_11111111-1111-4111-8111-111111111111",
  commandId: "integration:create:1",
  kind: "MCP",
  label: "AI World MCP",
  endpoint: { transport: "HTTPS", url: "https://world.example/api/mcp" },
  createdAt: registry.generatedAt,
};
function request(body: unknown) {
  return new Request("https://world.test/api/integrations", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://world.test" },
    body: JSON.stringify(body),
  });
}

describe("integration HTTP boundary", () => {
  it("authorizes safe list and create commands", async () => {
    const dependencies = {
      authorize: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue(registry),
      create: vi.fn().mockResolvedValue({ outcome: "CREATED" }),
      credential: vi.fn(),
      lifecycle: vi.fn(),
      probe: vi.fn(),
      action: vi.fn(),
      requestMutation: vi.fn(),
      decideMutation: vi.fn(),
    };
    const handlers = createIntegrationRouteHandlers(dependencies);
    expect((await handlers.GET(new Request("https://world.test/api/integrations"))).status).toBe(
      200,
    );
    expect((await handlers.POST(request(create))).status).toBe(201);
    expect(dependencies.create).toHaveBeenCalledWith(create);
  });

  it("keeps credential plaintext write-only and rejects cross-origin requests", async () => {
    const credential = vi.fn().mockResolvedValue({ outcome: "CREATED" });
    const handlers = createIntegrationRouteHandlers({
      authorize: vi.fn().mockResolvedValue(true),
      list: vi.fn(),
      create: vi.fn(),
      credential,
      lifecycle: vi.fn(),
      probe: vi.fn(),
      action: vi.fn(),
      requestMutation: vi.fn(),
      decideMutation: vi.fn(),
      now: () => new Date(registry.generatedAt),
    });
    const body = {
      operation: "CREDENTIAL",
      integrationId: create.id,
      commandId: "integration:credential:1",
      plaintext: "private-token",
    };
    const response = await handlers.POST(request(body));
    expect(response.status).toBe(201);
    expect(await response.text()).not.toContain("private-token");
    expect(
      (
        await handlers.POST(
          new Request("https://world.test/api/integrations", {
            method: "POST",
            headers: { origin: "https://evil.test" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("accepts idempotent enable and disable lifecycle commands", async () => {
    const lifecycle = vi.fn().mockResolvedValue({ outcome: "UPDATED" });
    const handlers = createIntegrationRouteHandlers({
      authorize: async () => true,
      list: vi.fn(),
      create: vi.fn(),
      credential: vi.fn(),
      lifecycle,
      probe: vi.fn(),
      action: vi.fn(),
      requestMutation: vi.fn(),
      decideMutation: vi.fn(),
    });
    const response = await handlers.POST(
      request({
        operation: "DISABLE",
        integrationId: create.id,
        commandId: "integration:disable:1",
      }),
    );
    expect(response.status).toBe(201);
    expect(lifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "DISABLE", integrationId: create.id }),
      expect.any(String),
    );
  });

  it("returns only a bounded protocol probe result", async () => {
    const probe = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      integrationId: create.id,
      health: "READY",
      code: "MCP_PROBE_OK",
      checkedAt: registry.generatedAt,
      outcome: "RECORDED",
    });
    const handlers = createIntegrationRouteHandlers({
      authorize: async () => true,
      list: vi.fn(),
      create: vi.fn(),
      credential: vi.fn(),
      lifecycle: vi.fn(),
      probe,
      action: vi.fn(),
      requestMutation: vi.fn(),
      decideMutation: vi.fn(),
      now: () => new Date(registry.generatedAt),
    });
    const response = await handlers.POST(
      request({ operation: "TEST", integrationId: create.id, commandId: "integration:test:1" }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({ health: "READY", code: "MCP_PROBE_OK" }),
      }),
    );
  });

  it("executes only a bounded predefined integration action", async () => {
    const action = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      integrationId: create.id,
      action: "MCP_LIST_TOOLS",
      outcome: "RECORDED",
      status: "SUCCEEDED",
      items: [{ id: "search", label: "Search" }],
      executedAt: registry.generatedAt,
    });
    const handlers = createIntegrationRouteHandlers({
      authorize: async () => true,
      list: vi.fn(),
      create: vi.fn(),
      credential: vi.fn(),
      lifecycle: vi.fn(),
      probe: vi.fn(),
      action,
      requestMutation: vi.fn(),
      decideMutation: vi.fn(),
      now: () => new Date(registry.generatedAt),
    });
    const response = await handlers.POST(
      request({
        operation: "ACTION",
        action: "MCP_LIST_TOOLS",
        integrationId: create.id,
        commandId: "integration:action:1",
      }),
    );
    expect(response.status).toBe(201);
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ action: "MCP_LIST_TOOLS", integrationId: create.id }),
      registry.generatedAt,
    );
    expect(await response.json()).toEqual(
      expect.objectContaining({ result: expect.objectContaining({ status: "SUCCEEDED" }) }),
    );
  });

  it("keeps mutation request and explicit owner approval as separate commands", async () => {
    const mutation = {
      kind: "GITHUB_DISPATCH_WORKFLOW" as const,
      owner: "maximalang",
      repository: "site",
      workflowId: "deploy.yml",
      ref: "main",
    };
    const receipt = {
      schemaVersion: 1 as const,
      requestId: "integration_mutation_11111111-1111-1111-1111-111111111111",
      integrationId: create.id,
      mutation,
      state: "PENDING" as const,
      outcome: "RECORDED" as const,
      requestedAt: registry.generatedAt,
    };
    const requestMutation = vi.fn().mockResolvedValue(receipt);
    const decideMutation = vi.fn().mockResolvedValue({
      ...receipt,
      state: "SUCCEEDED",
      decidedAt: registry.generatedAt,
      completedAt: registry.generatedAt,
    });
    const handlers = createIntegrationRouteHandlers({
      authorize: async () => true,
      list: vi.fn(),
      create: vi.fn(),
      credential: vi.fn(),
      lifecycle: vi.fn(),
      probe: vi.fn(),
      action: vi.fn(),
      requestMutation,
      decideMutation,
      now: () => new Date(registry.generatedAt),
    });
    expect(
      (
        await handlers.POST(
          request({
            operation: "REQUEST_MUTATION",
            requestId: receipt.requestId,
            integrationId: create.id,
            commandId: "integration:mutation:request:1",
            mutation,
          }),
        )
      ).status,
    ).toBe(201);
    expect(decideMutation).not.toHaveBeenCalled();
    expect(
      (
        await handlers.POST(
          request({
            operation: "DECIDE_MUTATION",
            requestId: receipt.requestId,
            commandId: "integration:mutation:approve:1",
            decision: "APPROVE",
          }),
        )
      ).status,
    ).toBe(201);
    expect(requestMutation).toHaveBeenCalledOnce();
    expect(decideMutation).toHaveBeenCalledOnce();
  });
});
