import { HubCommandRequestSchema } from "@agent-world/read-model";
import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import { HubCommandStoreError, PostgresHubCommandStore } from "./hub-command-store.js";

const parsedProviderCommand = HubCommandRequestSchema.parse({
  schemaVersion: 1,
  commandId: "hub_command_11111111-1111-1111-1111-111111111111",
  kind: "PROVIDER_CREATE",
  providerId: "provider_22222222-2222-2222-2222-222222222222",
  slug: "openai",
  displayName: "OpenAI",
  providerKind: "OPENAI",
  category: "LLM_API",
  baseUrl: "https://api.openai.com/v1",
});
if (parsedProviderCommand.kind !== "PROVIDER_CREATE") throw new Error("Invalid Provider fixture");
const providerCommand = parsedProviderCommand;

function pool(rows: unknown[][]) {
  const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [] as unknown[] }));
  for (const result of rows) query.mockResolvedValueOnce({ rows: result });
  const release = vi.fn();
  return {
    query,
    release,
    value: { connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionPool,
  };
}

describe("PostgresHubCommandStore", () => {
  it("creates a Provider and its receipt atomically", async () => {
    const fake = pool([[], [], [], [], [], []]);
    const result = await new PostgresHubCommandStore(
      fake.value,
      () => new Date("2026-08-13T12:00:00.000Z"),
    ).execute(providerCommand);

    expect(result).toEqual({
      schemaVersion: 1,
      outcome: "CREATED",
      commandId: providerCommand.commandId,
      resource: { kind: "PROVIDER", id: providerCommand.providerId },
    });
    expect(fake.query.mock.calls.map(([sql]) => String(sql))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("pg_advisory_xact_lock"),
        expect.stringContaining("INSERT INTO agent_world.providers"),
        expect.stringContaining("INSERT INTO agent_world.hub_command_receipts"),
      ]),
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("returns REPLAY for the exact previously committed command", async () => {
    const created = {
      schemaVersion: 1,
      outcome: "CREATED",
      commandId: providerCommand.commandId,
      resource: { kind: "PROVIDER", id: providerCommand.providerId },
    };
    const first = pool([[], [], [], [], [], []]);
    await new PostgresHubCommandStore(first.value).execute(providerCommand);
    const receiptInsert = first.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO agent_world.hub_command_receipts"),
    );
    const requestHash = receiptInsert?.[1]?.[2];
    const replay = pool([[], [], [{ request_sha256: requestHash, response: created }], []]);

    await expect(
      new PostgresHubCommandStore(replay.value).execute(providerCommand),
    ).resolves.toEqual({
      ...created,
      outcome: "REPLAY",
    });
    expect(
      replay.query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO agent_world.providers"),
      ),
    ).toBe(false);
    expect(replay.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("rejects reuse of a command identity with different immutable input", async () => {
    const fake = pool([[], [], [{ request_sha256: "a".repeat(64), response: {} }], []]);
    await expect(new PostgresHubCommandStore(fake.value).execute(providerCommand)).rejects.toEqual(
      new HubCommandStoreError("IDEMPOTENCY_CONFLICT"),
    );
    expect(fake.query).toHaveBeenLastCalledWith("ROLLBACK");
  });

  it("rolls back the resource when the receipt cannot be persisted", async () => {
    const fake = pool([[], [], [], []]);
    fake.query.mockRejectedValueOnce(new Error("receipt unavailable"));
    fake.query.mockResolvedValueOnce({ rows: [] });
    await expect(new PostgresHubCommandStore(fake.value).execute(providerCommand)).rejects.toThrow(
      "receipt unavailable",
    );
    expect(fake.query).toHaveBeenLastCalledWith("ROLLBACK");
  });

  it("creates a Codex route with server-owned safe policy in the same transaction", async () => {
    const command = HubCommandRequestSchema.parse({
      schemaVersion: 1,
      commandId: "hub_command_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      kind: "CODEX_ROUTE_CREATE",
      routeId: "route_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      accountId: "account_cccccccc-cccc-cccc-cccc-cccccccccccc",
      modelRouteId: "model_route_dddddddd-dddd-dddd-dddd-dddddddddddd",
      label: "Official Codex",
      reasoningEffort: "HIGH",
    });
    if (command.kind !== "CODEX_ROUTE_CREATE") throw new Error("Invalid Codex route fixture");
    const fake = pool([
      [],
      [],
      [],
      [{ id: command.routeId, remote_model_id: "gpt-5.6-codex" }],
      [],
      [],
      [],
    ]);

    await expect(new PostgresHubCommandStore(fake.value).execute(command)).resolves.toMatchObject({
      outcome: "CREATED",
      resource: { kind: "EXECUTION_ROUTE", id: command.routeId },
    });
    const policyCall = fake.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO agent_world.codex_execution_policies"),
    );
    expect(policyCall?.[0]).toContain("false, 600000");
    expect(policyCall?.[1]).toEqual([command.routeId, command.accountId, "gpt-5.6-codex", "HIGH"]);
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("rejects a Codex route unless Account and ModelRoute have exact Codex provenance", async () => {
    const command = HubCommandRequestSchema.parse({
      schemaVersion: 1,
      commandId: "hub_command_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      kind: "CODEX_ROUTE_CREATE",
      routeId: "route_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      accountId: "account_cccccccc-cccc-cccc-cccc-cccccccccccc",
      modelRouteId: "model_route_dddddddd-dddd-dddd-dddd-dddddddddddd",
      label: "Official Codex",
    });
    if (command.kind !== "CODEX_ROUTE_CREATE") throw new Error("Invalid Codex route fixture");
    const fake = pool([[], [], [], [], []]);
    await expect(new PostgresHubCommandStore(fake.value).execute(command)).rejects.toEqual(
      new HubCommandStoreError("INVALID_REFERENCE"),
    );
    expect(fake.query).toHaveBeenLastCalledWith("ROLLBACK");
  });

  it("creates an API or Local execution route only from eligible model provenance", async () => {
    const command = HubCommandRequestSchema.parse({
      schemaVersion: 1,
      commandId: "hub_command_81818181-8181-4181-8181-818181818181",
      kind: "MODEL_EXECUTION_ROUTE_CREATE",
      routeId: "route_82828282-8282-4282-8282-828282828282",
      modelRouteId: "model_route_83838383-8383-4383-8383-838383838383",
      label: "Primary API route",
    });
    if (command.kind !== "MODEL_EXECUTION_ROUTE_CREATE") throw new Error("Invalid route fixture");
    const fake = pool([[], [], [], [{ id: command.routeId }], [], []]);
    await expect(new PostgresHubCommandStore(fake.value).execute(command)).resolves.toMatchObject({
      outcome: "CREATED",
      resource: { kind: "EXECUTION_ROUTE", id: command.routeId },
    });
    const routeCall = fake.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO agent_world.execution_routes"),
    );
    expect(routeCall?.[0]).toContain("mr.surface = 'API'");
    expect(routeCall?.[0]).toContain("provider.category = 'LOCAL_MODEL'");
    expect(routeCall?.[0]).toContain("account.health = 'ACTIVE'");
  });

  it("atomically binds an Agent route and opens its model execution session", async () => {
    const command = HubCommandRequestSchema.parse({
      schemaVersion: 1,
      commandId: "hub_command_84848484-8484-4484-8484-848484848484",
      kind: "AGENT_ROUTE_BIND",
      bindingId: "binding_85858585-8585-4585-8585-858585858585",
      sessionId: "session_86868686-8686-4686-8686-868686868686",
      agentId: "agent_87878787-8787-4787-8787-878787878787",
      conversationId: "conversation_88888888-8888-4888-8888-888888888888",
      routeId: "route_82828282-8282-4282-8282-828282828282",
      externalAgentId: "agent:primary-api",
      externalSessionRef: "session:primary-api",
      startedAt: "2026-08-15T12:00:00.000Z",
    });
    if (command.kind !== "AGENT_ROUTE_BIND") throw new Error("Invalid binding fixture");
    const fake = pool([[], [], [], [{ adapter_kind: "API_MODEL" }], [], [], []]);
    await expect(new PostgresHubCommandStore(fake.value).execute(command)).resolves.toMatchObject({
      outcome: "CREATED",
      resource: {
        kind: "AGENT_ROUTE_BINDING",
        id: command.bindingId,
        sessionId: command.sessionId,
      },
    });
    const sessionCall = fake.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO agent_world.conversation_sessions"),
    );
    expect(sessionCall?.[1]).toEqual([
      command.sessionId,
      command.conversationId,
      command.agentId,
      command.bindingId,
      "API_MODEL",
      command.externalSessionRef,
      command.startedAt,
    ]);
  });

  it.each([
    [
      HubCommandRequestSchema.parse({
        schemaVersion: 1,
        commandId: "hub_command_33333333-3333-3333-3333-333333333333",
        kind: "ACCOUNT_CREATE",
        accountId: "account_11111111-1111-1111-1111-111111111111",
        providerId: providerCommand.providerId,
        label: "Primary account",
        authMechanism: "API_KEY",
        subscription: "Developer",
        availableSurfaces: ["API"],
      }),
      "INSERT INTO agent_world.accounts",
      "account_11111111-1111-1111-1111-111111111111",
    ],
    [
      HubCommandRequestSchema.parse({
        schemaVersion: 1,
        commandId: "hub_command_44444444-4444-4444-4444-444444444444",
        kind: "CANONICAL_MODEL_CREATE",
        modelId: "model_11111111-1111-1111-1111-111111111111",
        slug: "gpt-x",
        displayName: "GPT-X",
        family: "gpt",
        capabilities: {
          reasoning: true,
          toolUse: true,
          modalities: ["TEXT"],
          contextWindowTokens: 200_000,
        },
      }),
      "INSERT INTO agent_world.canonical_models",
      "model_11111111-1111-1111-1111-111111111111",
    ],
    [
      HubCommandRequestSchema.parse({
        schemaVersion: 1,
        commandId: "hub_command_55555555-5555-5555-5555-555555555555",
        kind: "MODEL_ROUTE_CREATE",
        modelRouteId: "model_route_11111111-1111-1111-1111-111111111111",
        canonicalModelId: "model_11111111-1111-1111-1111-111111111111",
        providerId: providerCommand.providerId,
        accountId: "account_11111111-1111-1111-1111-111111111111",
        surface: "API",
        remoteModelId: "gpt-x-2026-08-01",
        availability: "UNKNOWN",
        contextWindowTokens: 200_000,
        reasoningEfforts: ["LOW", "HIGH"],
        supportedModalities: ["TEXT"],
        supportedToolIds: [],
      }),
      "INSERT INTO agent_world.model_routes",
      "model_route_11111111-1111-1111-1111-111111111111",
    ],
    [
      HubCommandRequestSchema.parse({
        schemaVersion: 1,
        commandId: "hub_command_66666666-6666-6666-6666-666666666666",
        kind: "AGENT_CREATE",
        agentId: "agent_11111111-1111-1111-1111-111111111111",
        slug: "researcher",
        displayName: "Researcher",
        role: "Primary-source research",
        instructions: "Preserve evidence.",
      }),
      "INSERT INTO agent_world.agents",
      "agent_11111111-1111-1111-1111-111111111111",
    ],
    [
      HubCommandRequestSchema.parse({
        schemaVersion: 1,
        commandId: "hub_command_77777777-7777-7777-7777-777777777777",
        kind: "SKILL_CREATE",
        skillId: "skill_11111111-1111-1111-1111-111111111111",
        slug: "source-research",
        displayName: "Source research",
        version: "1.0.0",
        description: "Verify primary sources.",
        sourceKind: "LOCAL_PATH",
        sourceRef: "skills/source-research/SKILL.md",
        integritySha256: "a".repeat(64),
      }),
      "INSERT INTO agent_world.skills",
      "skill_11111111-1111-1111-1111-111111111111",
    ],
    [
      HubCommandRequestSchema.parse({
        schemaVersion: 1,
        commandId: "hub_command_88888888-8888-8888-8888-888888888888",
        kind: "TOOL_CREATE",
        toolId: "tool_11111111-1111-1111-1111-111111111111",
        slug: "browser-search",
        displayName: "Browser search",
        toolKind: "BROWSER",
        description: "Search public sources.",
      }),
      "INSERT INTO agent_world.tools",
      "tool_11111111-1111-1111-1111-111111111111",
    ],
    [
      HubCommandRequestSchema.parse({
        schemaVersion: 1,
        commandId: "hub_command_99999999-9999-9999-9999-999999999999",
        kind: "PROJECT_CREATE",
        projectId: "project_11111111-1111-1111-1111-111111111111",
        slug: "agent-world",
        name: "Agent World",
        description: "Canonical context.",
      }),
      "INSERT INTO agent_world.projects",
      "project_11111111-1111-1111-1111-111111111111",
    ],
  ] as const)(
    "persists $kind through its canonical table",
    async (command, expectedSql, expectedId) => {
      const fake = pool([]);
      const response = await new PostgresHubCommandStore(fake.value).execute(command);
      expect(response.resource.id).toBe(expectedId);
      expect(fake.query.mock.calls.some(([sql]) => String(sql).includes(expectedSql))).toBe(true);
      expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
    },
  );

  it.each([
    ["23505", "RESOURCE_CONFLICT"],
    ["23503", "INVALID_REFERENCE"],
    ["23514", "INVALID_REFERENCE"],
  ] as const)("maps PostgreSQL %s without leaking database details", async (code, expected) => {
    const fake = pool([[], [], []]);
    fake.query.mockRejectedValueOnce(
      Object.assign(new Error("sensitive database detail"), { code }),
    );
    await expect(new PostgresHubCommandStore(fake.value).execute(providerCommand)).rejects.toEqual(
      new HubCommandStoreError(expected),
    );
    expect(fake.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
});
