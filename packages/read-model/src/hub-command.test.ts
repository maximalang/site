import { describe, expect, it } from "vitest";
import { HubCommandRequestSchema, HubCommandResponseSchema } from "./hub-command.js";

const base = {
  schemaVersion: 1,
  commandId: "hub_command_11111111-1111-1111-1111-111111111111",
} as const;

describe("Hub control-plane command contracts", () => {
  it.each([
    {
      ...base,
      kind: "PROVIDER_CREATE",
      providerId: "provider_22222222-2222-2222-2222-222222222222",
      slug: "openai",
      displayName: "OpenAI",
      providerKind: "OPENAI",
      category: "LLM_API",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      ...base,
      kind: "ACCOUNT_CREATE",
      accountId: "account_22222222-2222-2222-2222-222222222222",
      providerId: "provider_33333333-3333-3333-3333-333333333333",
      label: "Primary API account",
      authMechanism: "API_KEY",
      subscription: "Developer",
      availableSurfaces: ["API"],
    },
    {
      ...base,
      kind: "CANONICAL_MODEL_CREATE",
      modelId: "model_22222222-2222-2222-2222-222222222222",
      slug: "gpt-x",
      displayName: "GPT-X",
      family: "gpt",
      capabilities: {
        reasoning: true,
        toolUse: true,
        modalities: ["TEXT", "IMAGE_INPUT"],
        contextWindowTokens: 200_000,
        maxOutputTokens: 32_000,
      },
    },
    {
      ...base,
      kind: "MODEL_ROUTE_CREATE",
      modelRouteId: "model_route_22222222-2222-2222-2222-222222222222",
      canonicalModelId: "model_33333333-3333-3333-3333-333333333333",
      providerId: "provider_44444444-4444-4444-4444-444444444444",
      accountId: "account_55555555-5555-5555-5555-555555555555",
      surface: "API",
      remoteModelId: "gpt-x-2026-08-01",
      availability: "UNKNOWN",
      contextWindowTokens: 200_000,
      reasoningEfforts: ["LOW", "HIGH"],
      supportedModalities: ["TEXT"],
      supportedToolIds: [],
    },
    {
      ...base,
      kind: "CODEX_ROUTE_CREATE",
      routeId: "route_22222222-2222-2222-2222-222222222222",
      accountId: "account_55555555-5555-5555-5555-555555555555",
      modelRouteId: "model_route_22222222-2222-2222-2222-222222222222",
      label: "Official Codex",
      reasoningEffort: "HIGH",
    },
    {
      ...base,
      kind: "AGENT_CREATE",
      agentId: "agent_22222222-2222-2222-2222-222222222222",
      slug: "researcher",
      displayName: "Researcher",
      role: "Primary-source research",
      instructions: "Use primary sources and preserve evidence.",
    },
    {
      ...base,
      kind: "SKILL_CREATE",
      skillId: "skill_22222222-2222-2222-2222-222222222222",
      slug: "source-research",
      displayName: "Source research",
      version: "1.2.0",
      description: "Collect and verify primary sources.",
      sourceKind: "LOCAL_PATH",
      sourceRef: "skills/source-research/SKILL.md",
      integritySha256: "a".repeat(64),
    },
    {
      ...base,
      kind: "TOOL_CREATE",
      toolId: "tool_22222222-2222-2222-2222-222222222222",
      slug: "browser-search",
      displayName: "Browser search",
      toolKind: "BROWSER",
      description: "Search owner-approved public sources.",
    },
    {
      ...base,
      kind: "PROJECT_CREATE",
      projectId: "project_22222222-2222-2222-2222-222222222222",
      slug: "canonical-hub",
      name: "Canonical Hub",
      description: "Shared implementation context.",
    },
  ] as const)("accepts $kind without server-owned state", (command) => {
    const parsed = HubCommandRequestSchema.parse(command);
    expect(parsed).not.toHaveProperty("createdAt");
    expect(parsed).not.toHaveProperty("isEnabled");
    expect(parsed).not.toHaveProperty("health");
  });

  it("rejects raw credentials, Tool configuration and provider-specific drift", () => {
    const account = {
      ...base,
      kind: "ACCOUNT_CREATE",
      accountId: "account_22222222-2222-2222-2222-222222222222",
      providerId: "provider_33333333-3333-3333-3333-333333333333",
      label: "Unsafe account",
      authMechanism: "API_KEY",
      availableSurfaces: ["API"],
      apiKey: "must-not-cross-command-boundary",
    };
    const tool = {
      ...base,
      kind: "TOOL_CREATE",
      toolId: "tool_22222222-2222-2222-2222-222222222222",
      slug: "unsafe-tool",
      displayName: "Unsafe tool",
      toolKind: "HTTP",
      description: "Must remain metadata-only.",
      configurationRef: "vault:tools/private",
    };
    const route = {
      ...base,
      kind: "MODEL_ROUTE_CREATE",
      modelRouteId: "model_route_22222222-2222-2222-2222-222222222222",
      canonicalModelId: "model_33333333-3333-3333-3333-333333333333",
      providerId: "provider_44444444-4444-4444-4444-444444444444",
      surface: "API",
      remoteModelId: "gpt-x",
      availability: "UNKNOWN",
      contextWindowTokens: 100_000,
      reasoningEfforts: [],
      supportedModalities: ["TEXT"],
      supportedToolIds: [],
      openaiOrganization: "provider-specific-drift",
    };
    const unsafeCodexRoute = {
      ...base,
      kind: "CODEX_ROUTE_CREATE",
      routeId: "route_22222222-2222-2222-2222-222222222222",
      accountId: "account_55555555-5555-5555-5555-555555555555",
      modelRouteId: "model_route_22222222-2222-2222-2222-222222222222",
      label: "Unsafe Codex",
      reasoningEffort: "HIGH",
      networkAccess: true,
    };

    for (const command of [account, tool, route, unsafeCodexRoute]) {
      expect(HubCommandRequestSchema.safeParse(command).success).toBe(false);
    }
  });

  it("returns only a canonical resource receipt", () => {
    const response = HubCommandResponseSchema.parse({
      schemaVersion: 1,
      outcome: "CREATED",
      commandId: base.commandId,
      resource: {
        kind: "ACCOUNT",
        id: "account_22222222-2222-2222-2222-222222222222",
      },
    });

    expect(JSON.stringify(response)).not.toMatch(/credential|apiKey|instructions|sourceRef/);
  });
});
