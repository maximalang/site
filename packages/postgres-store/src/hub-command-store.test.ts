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
