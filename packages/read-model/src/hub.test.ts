import { describe, expect, it } from "vitest";
import { HubReadModelSchema } from "./hub.js";

const fixture = {
  schemaVersion: 1,
  generatedAt: "2026-08-13T12:00:00.000Z",
  providers: [
    {
      providerId: "provider_11111111-1111-1111-1111-111111111111",
      slug: "openai",
      displayName: "OpenAI",
      kind: "OPENAI",
      category: "LLM_API",
      baseUrl: "https://api.openai.com/v1",
      isEnabled: true,
    },
  ],
  accounts: [
    {
      accountId: "account_22222222-2222-2222-2222-222222222222",
      providerId: "provider_11111111-1111-1111-1111-111111111111",
      label: "Primary API account",
      authMechanism: "API_KEY",
      availableSurfaces: ["API"],
      health: "ACTIVE",
      isEnabled: true,
      createdAt: "2026-08-13T10:00:00.000Z",
    },
  ],
  models: [
    {
      modelId: "model_33333333-3333-3333-3333-333333333333",
      slug: "gpt-x",
      displayName: "GPT-X",
      family: "gpt",
      capabilities: {
        reasoning: true,
        toolUse: true,
        modalities: ["TEXT"],
        contextWindowTokens: 200_000,
        maxOutputTokens: 32_000,
      },
      isEnabled: true,
      routes: [
        {
          modelRouteId: "model_route_44444444-4444-4444-4444-444444444444",
          providerId: "provider_11111111-1111-1111-1111-111111111111",
          accountId: "account_22222222-2222-2222-2222-222222222222",
          surface: "API",
          remoteModelId: "gpt-x-2026-08-01",
          availability: "AVAILABLE",
          contextWindowTokens: 200_000,
          reasoningEfforts: ["LOW", "HIGH"],
          supportedModalities: ["TEXT"],
          supportedToolIds: ["tool_77777777-7777-7777-7777-777777777777"],
          isEnabled: true,
        },
      ],
    },
  ],
  executionRoutes: [
    {
      routeId: "route_55555555-5555-5555-5555-555555555555",
      label: "Primary GPT-X",
      mode: "API",
      adapterKind: "API_MODEL",
      accountId: "account_22222222-2222-2222-2222-222222222222",
      modelRouteId: "model_route_44444444-4444-4444-4444-444444444444",
      isEnabled: true,
    },
  ],
  agents: [
    {
      agentId: "agent_66666666-6666-6666-6666-666666666666",
      slug: "researcher",
      displayName: "Researcher",
      role: "Primary-source research",
      preferredRouteId: "route_55555555-5555-5555-5555-555555555555",
      isEnabled: true,
      skillAssignments: [
        {
          skillId: "skill_88888888-8888-8888-8888-888888888888",
          priority: 10,
          isEnabled: true,
        },
      ],
      toolAssignments: [{ toolId: "tool_77777777-7777-7777-7777-777777777777", isEnabled: true }],
    },
  ],
  skills: [
    {
      skillId: "skill_88888888-8888-8888-8888-888888888888",
      slug: "source-research",
      displayName: "Source research",
      version: "1.2.0",
      description: "Collect and verify primary sources.",
      sourceKind: "LOCAL_PATH",
      integritySha256: "a".repeat(64),
      isEnabled: true,
    },
  ],
  tools: [
    {
      toolId: "tool_77777777-7777-7777-7777-777777777777",
      slug: "browser-search",
      displayName: "Browser search",
      kind: "BROWSER",
      description: "Search owner-approved public sources.",
      isEnabled: true,
    },
  ],
  projects: [
    {
      projectId: "project_99999999-9999-9999-9999-999999999999",
      slug: "canonical-hub",
      name: "Canonical Hub",
      description: "Shared Hub implementation context.",
      isArchived: false,
      createdAt: "2026-08-13T09:00:00.000Z",
      agentIds: ["agent_66666666-6666-6666-6666-666666666666"],
    },
  ],
} as const;

describe("HubReadModelSchema", () => {
  it("accepts one canonical model with nested provider/account routes", () => {
    const parsed = HubReadModelSchema.parse(fixture);

    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0]?.routes).toHaveLength(1);
    expect(parsed.models[0]).not.toHaveProperty("providerId");
    expect(parsed.models[0]).not.toHaveProperty("accountId");
    expect(parsed.transportCapabilities).toEqual([
      expect.objectContaining({
        mode: "CHAT",
        support: "EXPERIMENTAL",
        dispatchMode: "BROWSER_ON_DEMAND",
        resultChannel: "CONTROL_API",
        contextMode: "LAZY_PULL",
        selectable: false,
      }),
      expect.objectContaining({
        mode: "WORK",
        support: "EXPERIMENTAL",
        dispatchMode: "SERVER_API",
        selectable: false,
      }),
      expect.objectContaining({
        mode: "CODEX",
        support: "OFFICIAL",
        dispatchMode: "LOCAL_PROCESS",
        selectable: true,
      }),
    ]);
  });

  it("rejects selectable unsupported native transports", () => {
    const parsed = HubReadModelSchema.parse(fixture);
    expect(
      HubReadModelSchema.safeParse({
        ...parsed,
        transportCapabilities: parsed.transportCapabilities.map((capability) =>
          capability.mode === "CHAT"
            ? { ...capability, support: "UNSUPPORTED", selectable: true }
            : capability,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects secrets, runtime locators, Agent instructions and source/config references", () => {
    const unsafeValues = [
      { ...fixture, accounts: [{ ...fixture.accounts[0], credentialRef: "vault:account" }] },
      { ...fixture, agents: [{ ...fixture.agents[0], instructions: "private instructions" }] },
      { ...fixture, tools: [{ ...fixture.tools[0], configurationRef: "vault:tool" }] },
      { ...fixture, skills: [{ ...fixture.skills[0], sourceRef: "C:/private/skill" }] },
      { ...fixture, agents: [{ ...fixture.agents[0], bindingId: "binding_private" }] },
    ];

    for (const value of unsafeValues)
      expect(HubReadModelSchema.safeParse(value).success).toBe(false);
  });

  it("rejects duplicate or non-deterministically ordered canonical identities", () => {
    expect(
      HubReadModelSchema.safeParse({ ...fixture, models: [fixture.models[0], fixture.models[0]] })
        .success,
    ).toBe(false);
    expect(
      HubReadModelSchema.safeParse({
        ...fixture,
        providers: [
          { ...fixture.providers[0], providerId: "provider_ffffffff-ffff-ffff-ffff-ffffffffffff" },
          fixture.providers[0],
        ],
      }).success,
    ).toBe(false);
  });
});
