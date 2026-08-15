import { describe, expect, it } from "vitest";
import { IntegrationCreateSchema, IntegrationRegistrySchema } from "./integration.js";

describe("Integration contracts", () => {
  it("separates HTTPS adapters from SSH locators and omits credentials", () => {
    const https = IntegrationCreateSchema.parse({
      id: "integration_11111111-1111-4111-8111-111111111111",
      commandId: "integration:create:1",
      kind: "MCP",
      label: "AI World MCP",
      endpoint: { transport: "HTTPS", url: "https://world.example/api/mcp" },
      createdAt: "2026-08-15T12:00:00.000Z",
    });
    const ssh = IntegrationCreateSchema.parse({
      id: "integration_22222222-2222-4222-8222-222222222222",
      commandId: "integration:create:2",
      kind: "SSH",
      label: "Timeweb VDS",
      endpoint: { transport: "SSH", host: "vds.example", username: "agent-world" },
      createdAt: "2026-08-15T12:00:00.000Z",
    });
    expect(https.endpoint.transport).toBe("HTTPS");
    expect(ssh.endpoint).toEqual(expect.objectContaining({ port: 22 }));
    expect(JSON.stringify([https, ssh])).not.toMatch(/password|privateKey|token/);
  });

  it("rejects insecure remote HTTP and credential leakage", () => {
    const input = {
      id: "integration_11111111-1111-4111-8111-111111111111",
      commandId: "integration:create:1",
      kind: "N8N",
      label: "n8n",
      endpoint: { transport: "HTTPS", url: "http://remote.example" },
      createdAt: "2026-08-15T12:00:00.000Z",
    };
    expect(IntegrationCreateSchema.safeParse(input).success).toBe(false);
    expect(
      IntegrationRegistrySchema.safeParse({
        schemaVersion: 1,
        generatedAt: input.createdAt,
        integrations: [
          { ...input, health: "READY", isEnabled: true, hasCredential: true, password: "secret" },
        ],
      }).success,
    ).toBe(false);
  });
});
