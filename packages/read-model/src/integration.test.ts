import { describe, expect, it } from "vitest";
import {
  IntegrationActionSchema,
  IntegrationCreateSchema,
  IntegrationMutationReceiptSchema,
  IntegrationMutationSchema,
  IntegrationRegistrySchema,
  IntegrationSshOperationCreateSchema,
  IntegrationToolAllowlistCreateSchema,
} from "./integration.js";

describe("Integration contracts", () => {
  it("accepts only predefined bounded integration mutations", () => {
    expect(
      IntegrationMutationSchema.parse({
        kind: "MCP_CALL_REGISTERED_TOOL",
        toolAllowlistId: "integration_tool_11111111-1111-1111-1111-111111111111",
      }).kind,
    ).toBe("MCP_CALL_REGISTERED_TOOL");
    expect(() =>
      IntegrationMutationSchema.parse({
        kind: "MCP_CALL_REGISTERED_TOOL",
        toolName: "dangerous_tool",
        arguments: { command: "rm -rf /" },
      }),
    ).toThrow();
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

  it("registers immutable bounded MCP arguments instead of caller-owned invocation input", () => {
    expect(
      IntegrationToolAllowlistCreateSchema.parse({
        id: "integration_tool_11111111-1111-1111-1111-111111111111",
        integrationId: "integration_11111111-1111-1111-1111-111111111111",
        commandId: "integration:tool:create:1",
        label: "Publish approved artifact",
        toolName: "artifact.publish",
        fixedArguments: { channel: "review" },
        createdAt: "2026-08-15T12:00:00.000Z",
      }).fixedArguments,
    ).toEqual({ channel: "review" });
  });

  it("registers typed SSH operations and rejects arbitrary remote commands", () => {
    expect(
      IntegrationSshOperationCreateSchema.parse({
        id: "integration_ssh_operation_11111111-1111-1111-1111-111111111111",
        integrationId: "integration_11111111-1111-1111-1111-111111111111",
        commandId: "integration:ssh-operation:create:1",
        label: "Restart Agent World",
        operationKind: "SYSTEMD_RESTART",
        systemdUnit: "agent-world.service",
        hostKeySha256: `SHA256:${"A".repeat(43)}`,
        createdAt: "2026-08-15T12:00:00.000Z",
      }).operationKind,
    ).toBe("SYSTEMD_RESTART");
    expect(() =>
      IntegrationMutationSchema.parse({
        kind: "SSH_RUN_REGISTERED_OPERATION",
        command: "rm -rf /",
      }),
    ).toThrow();
    expect(() =>
      IntegrationSshOperationCreateSchema.parse({
        id: "integration_ssh_operation_11111111-1111-1111-1111-111111111111",
        integrationId: "integration_11111111-1111-1111-1111-111111111111",
        commandId: "integration:ssh-operation:create:2",
        label: "Unsafe deploy",
        operationKind: "DOCKER_COMPOSE_DEPLOY",
        composeProject: "agent-world;reboot",
        workingDirectory: "/srv/agent-world && reboot",
        hostKeySha256: `SHA256:${"A".repeat(43)}`,
        createdAt: "2026-08-15T12:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      IntegrationSshOperationCreateSchema.parse({
        id: "integration_ssh_operation_22222222-2222-2222-2222-222222222222",
        integrationId: "integration_11111111-1111-1111-1111-111111111111",
        commandId: "integration:ssh-operation:create:3",
        label: "Traversal deploy",
        operationKind: "DOCKER_COMPOSE_DEPLOY",
        composeProject: "agent-world",
        workingDirectory: "/srv/../root",
        hostKeySha256: `SHA256:${"A".repeat(43)}`,
        createdAt: "2026-08-15T12:00:00.000Z",
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
    const steel = IntegrationCreateSchema.parse({
      id: "integration_33333333-3333-4333-8333-333333333333",
      commandId: "integration:create:steel",
      kind: "STEEL",
      label: "Steel browser sessions",
      endpoint: { transport: "HTTPS", url: "https://steel.example" },
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
    expect(steel.endpoint.transport).toBe("HTTPS");
    expect(IntegrationActionSchema.parse("STEEL_LIST_SESSIONS")).toBe("STEEL_LIST_SESSIONS");
    expect(ssh.endpoint).toEqual(expect.objectContaining({ port: 22 }));
    expect(JSON.stringify([https, steel, ssh])).not.toMatch(/password|privateKey|token/);
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
