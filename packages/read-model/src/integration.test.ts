import { describe, expect, it } from "vitest";
import {
  IntegrationCreateSchema,
  IntegrationMutationReceiptSchema,
  IntegrationMutationSchema,
  IntegrationRegistrySchema,
} from "./integration.js";

describe("Integration contracts", () => {
  it("accepts only predefined bounded integration mutations", () => {
    expect(() =>
      IntegrationMutationSchema.parse({
        kind: "N8N_TRIGGER_WEBHOOK",
        webhookPath: "/webhook/daily_sync",
      }),
    ).toThrow();
    expect(() =>
      IntegrationMutationSchema.parse({ kind: "SSH_COMMAND", command: "rm -rf /" }),
    ).toThrow();
    expect(() =>
      IntegrationMutationSchema.parse({
        kind: "GITHUB_DISPATCH_WORKFLOW",
        owner: "owner",
        repository: "repo",
        workflowId: "deploy.yml",
        ref: "main; shutdown",
      }),
    ).toThrow();
  });

  it("keeps an outcome-unknown mutation distinct from a retryable failure", () => {
    expect(
      IntegrationMutationReceiptSchema.parse({
        schemaVersion: 1,
        requestId: "integration_mutation_11111111-1111-1111-1111-111111111111",
        integrationId: "integration_11111111-1111-1111-1111-111111111111",
        mutation: {
          kind: "GITHUB_DISPATCH_WORKFLOW",
          owner: "owner",
          repository: "repo",
          workflowId: "deploy.yml",
          ref: "main",
        },
        state: "OUTCOME_UNKNOWN",
        outcome: "REPLAY",
        requestedAt: "2026-08-15T12:00:00.000Z",
        decidedAt: "2026-08-15T12:01:00.000Z",
        completedAt: "2026-08-15T12:02:00.000Z",
        failureCode: "INTERRUPTED_OUTCOME_UNKNOWN",
      }).state,
    ).toBe("OUTCOME_UNKNOWN");
  });

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
