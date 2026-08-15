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
});
