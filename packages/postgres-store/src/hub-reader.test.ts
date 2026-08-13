import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import { PostgresHubReader } from "./hub-reader.js";

const ids = {
  account: "account_11111111-1111-1111-1111-111111111111",
  agent: "agent_22222222-2222-2222-2222-222222222222",
  model: "model_33333333-3333-3333-3333-333333333333",
  modelRoute: "model_route_44444444-4444-4444-4444-444444444444",
  project: "project_55555555-5555-5555-5555-555555555555",
  provider: "provider_66666666-6666-6666-6666-666666666666",
  route: "route_77777777-7777-7777-7777-777777777777",
  skill: "skill_88888888-8888-8888-8888-888888888888",
  tool: "tool_99999999-9999-9999-9999-999999999999",
};

function resultFor(sql: string): unknown[] {
  if (sql.includes("FROM agent_world.providers")) {
    return [
      {
        id: ids.provider,
        slug: "openai",
        display_name: "OpenAI",
        kind: "OPENAI",
        category: "LLM_API",
        base_url: "https://api.openai.com/v1",
        is_enabled: true,
      },
    ];
  }
  if (sql.includes("FROM agent_world.account_surfaces")) {
    return [{ account_id: ids.account, surface: "API" }];
  }
  if (sql.includes("FROM agent_world.accounts")) {
    return [
      {
        id: ids.account,
        provider_id: ids.provider,
        label: "Primary API account",
        auth_mechanism: "API_KEY",
        subscription: "Developer",
        health: "ACTIVE",
        last_successful_auth_at: new Date("2026-08-13T10:01:00.000Z"),
        is_enabled: true,
        created_at: new Date("2026-08-13T10:00:00.000Z"),
      },
    ];
  }
  if (sql.includes("FROM agent_world.canonical_model_modalities")) {
    return [{ canonical_model_id: ids.model, modality: "TEXT" }];
  }
  if (sql.includes("FROM agent_world.canonical_models")) {
    return [
      {
        id: ids.model,
        slug: "gpt-x",
        display_name: "GPT-X",
        family: "gpt",
        reasoning: true,
        tool_use: true,
        context_window_tokens: "200000",
        max_output_tokens: "32000",
        is_enabled: true,
      },
    ];
  }
  if (sql.includes("FROM agent_world.model_route_reasoning_efforts")) {
    return [{ model_route_id: ids.modelRoute, effort: "HIGH" }];
  }
  if (sql.includes("FROM agent_world.model_route_modalities")) {
    return [{ model_route_id: ids.modelRoute, modality: "TEXT" }];
  }
  if (sql.includes("FROM agent_world.model_route_tools")) {
    return [{ model_route_id: ids.modelRoute, tool_id: ids.tool }];
  }
  if (sql.includes("FROM agent_world.model_routes")) {
    return [
      {
        id: ids.modelRoute,
        canonical_model_id: ids.model,
        provider_id: ids.provider,
        account_id: ids.account,
        surface: "API",
        remote_model_id: "gpt-x-2026-08-01",
        availability: "AVAILABLE",
        price_currency: "USD",
        input_price_per_million: "2.50000000",
        output_price_per_million: "10.00000000",
        requests_per_minute: 500,
        tokens_per_minute: "2000000",
        latency_p50_ms: "420.000",
        quality_score: "92.50",
        context_window_tokens: "200000",
        is_enabled: true,
      },
    ];
  }
  if (sql.includes("FROM agent_world.execution_routes")) {
    return [
      {
        id: ids.route,
        label: "Primary GPT-X",
        mode: "API",
        adapter_kind: "API_MODEL",
        account_id: ids.account,
        model_route_id: ids.modelRoute,
        is_enabled: true,
      },
    ];
  }
  if (sql.includes("FROM agent_world.agent_skills")) {
    return [{ agent_id: ids.agent, skill_id: ids.skill, priority: 10, is_enabled: true }];
  }
  if (sql.includes("FROM agent_world.agent_tools")) {
    return [{ agent_id: ids.agent, tool_id: ids.tool, is_enabled: true }];
  }
  if (sql.includes("FROM agent_world.agents")) {
    return [
      {
        id: ids.agent,
        slug: "researcher",
        display_name: "Researcher",
        role: "Primary-source research",
        preferred_route_id: ids.route,
        is_enabled: true,
      },
    ];
  }
  if (sql.includes("FROM agent_world.skills")) {
    return [
      {
        id: ids.skill,
        slug: "source-research",
        display_name: "Source research",
        version: "1.2.0",
        description: "Collect and verify primary sources.",
        source_kind: "LOCAL_PATH",
        integrity_sha256: "a".repeat(64),
        is_enabled: true,
      },
    ];
  }
  if (sql.includes("FROM agent_world.tools")) {
    return [
      {
        id: ids.tool,
        slug: "browser-search",
        display_name: "Browser search",
        kind: "BROWSER",
        description: "Search owner-approved public sources.",
        is_enabled: true,
      },
    ];
  }
  if (sql.includes("FROM agent_world.project_agents")) {
    return [{ project_id: ids.project, agent_id: ids.agent }];
  }
  if (sql.includes("FROM agent_world.projects")) {
    return [
      {
        id: ids.project,
        slug: "canonical-hub",
        name: "Canonical Hub",
        description: "Shared Hub implementation context.",
        is_archived: false,
        created_at: new Date("2026-08-13T09:00:00.000Z"),
      },
    ];
  }
  return [];
}

function pool(queryImplementation?: (sql: string) => unknown[]) {
  const query = vi.fn(async (sql: string) => ({ rows: (queryImplementation ?? resultFor)(sql) }));
  const release = vi.fn();
  return {
    query,
    release,
    value: { connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionPool,
  };
}

describe("PostgresHubReader", () => {
  it("reads one deterministic safe snapshot with ModelRoutes nested under CanonicalModel", async () => {
    const fake = pool();
    const hub = await new PostgresHubReader(
      fake.value,
      () => new Date("2026-08-13T12:00:00.000Z"),
    ).read();

    expect(hub.models).toHaveLength(1);
    expect(hub.models[0]?.routes[0]?.modelRouteId).toBe(ids.modelRoute);
    expect(hub.accounts[0]?.availableSurfaces).toEqual(["API"]);
    expect(hub.agents[0]?.skillAssignments[0]?.skillId).toBe(ids.skill);
    expect(hub.projects[0]?.agentIds).toEqual([ids.agent]);
    expect(JSON.stringify(hub)).not.toMatch(
      /credentialRef|credential_ref|configurationRef|configuration_ref|sourceRef|source_ref|instructions|binding_|session_|secret-store/,
    );

    const sql = fake.query.mock.calls.map(([statement]) => statement).join("\n");
    expect(sql).toContain("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(sql).toContain("COMMIT");
    expect(sql).not.toMatch(
      /credential_ref|configuration_ref|source_ref|instructions|runtime_bindings|conversation_sessions/,
    );
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("fails closed and rolls back when a bounded collection overflows", async () => {
    const fake = pool((sql) =>
      sql.includes("FROM agent_world.providers") ? Array.from({ length: 101 }, () => ({})) : [],
    );

    await expect(new PostgresHubReader(fake.value).read()).rejects.toThrow("Provider");
    expect(fake.query.mock.calls.map(([statement]) => statement)).toContain("ROLLBACK");
    expect(fake.release).toHaveBeenCalledOnce();
  });
});
