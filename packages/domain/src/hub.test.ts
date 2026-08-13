import { describe, expect, it } from "vitest";
import {
  AccountSchema,
  AgentSkillAssignmentSchema,
  AgentToolAssignmentSchema,
  CanonicalModelSchema,
  ModelRouteSchema,
  ProjectAgentMembershipSchema,
  ProjectSchema,
  ProviderSchema,
  SkillSchema,
  ToolSchema,
} from "./index.js";

const UUIDS = {
  account: "11111111-1111-1111-1111-111111111111",
  agent: "22222222-2222-2222-2222-222222222222",
  model: "33333333-3333-3333-3333-333333333333",
  modelRoute: "44444444-4444-4444-4444-444444444444",
  project: "55555555-5555-5555-5555-555555555555",
  provider: "66666666-6666-6666-6666-666666666666",
  skill: "77777777-7777-7777-7777-777777777777",
  tool: "88888888-8888-8888-8888-888888888888",
};

describe("canonical Hub contracts", () => {
  it("keeps Provider, Account and Agent as separate identities without credential values", () => {
    const provider = ProviderSchema.parse({
      schemaVersion: 1,
      id: `provider_${UUIDS.provider}`,
      slug: "openai",
      displayName: "OpenAI",
      kind: "OPENAI",
      category: "LLM_API",
      baseUrl: "https://api.openai.com/v1",
      isEnabled: true,
    });
    const account = AccountSchema.parse({
      schemaVersion: 1,
      id: `account_${UUIDS.account}`,
      providerId: provider.id,
      label: "Primary API account",
      authMechanism: "API_KEY",
      availableSurfaces: ["API"],
      health: "UNCONFIGURED",
      credentialRef: "secret-store:accounts/openai-primary",
      isEnabled: true,
      createdAt: "2026-08-13T12:00:00.000Z",
    });

    expect(account.providerId).toBe(provider.id);
    expect(account).not.toHaveProperty("apiKey");
    expect(account).not.toHaveProperty("token");
    expect(account.id).not.toBe(provider.id);
  });

  it("represents one physical model once with provider/account-specific ModelRoutes", () => {
    const model = CanonicalModelSchema.parse({
      schemaVersion: 1,
      id: `model_${UUIDS.model}`,
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
      isEnabled: true,
    });
    const route = ModelRouteSchema.parse({
      schemaVersion: 1,
      id: `model_route_${UUIDS.modelRoute}`,
      canonicalModelId: model.id,
      providerId: `provider_${UUIDS.provider}`,
      accountId: `account_${UUIDS.account}`,
      surface: "API",
      remoteModelId: "gpt-x-2026-08-01",
      availability: "AVAILABLE",
      pricing: { currency: "USD", inputPerMillion: 2.5, outputPerMillion: 10 },
      limits: { requestsPerMinute: 500, tokensPerMinute: 2_000_000 },
      latencyP50Ms: 420,
      qualityScore: 92.5,
      contextWindowTokens: 200_000,
      reasoningEfforts: ["LOW", "MEDIUM", "HIGH"],
      supportedModalities: ["TEXT", "IMAGE_INPUT"],
      supportedToolIds: [`tool_${UUIDS.tool}`],
      isEnabled: true,
    });

    expect(route.canonicalModelId).toBe(model.id);
    expect(model).not.toHaveProperty("providerId");
    expect(model).not.toHaveProperty("accountId");
  });

  it("rejects duplicate route capabilities and secret-shaped drift", () => {
    const duplicateModalities = ModelRouteSchema.safeParse({
      schemaVersion: 1,
      id: `model_route_${UUIDS.modelRoute}`,
      canonicalModelId: `model_${UUIDS.model}`,
      providerId: `provider_${UUIDS.provider}`,
      surface: "API",
      remoteModelId: "gpt-x",
      availability: "AVAILABLE",
      contextWindowTokens: 100_000,
      reasoningEfforts: [],
      supportedModalities: ["TEXT", "TEXT"],
      supportedToolIds: [],
      isEnabled: true,
    });
    const leakedSecret = AccountSchema.safeParse({
      schemaVersion: 1,
      id: `account_${UUIDS.account}`,
      providerId: `provider_${UUIDS.provider}`,
      label: "Unsafe account",
      authMechanism: "API_KEY",
      availableSurfaces: ["API"],
      health: "ACTIVE",
      apiKey: "must-not-enter-domain",
      isEnabled: true,
      createdAt: "2026-08-13T12:00:00.000Z",
    });

    expect(duplicateModalities.success).toBe(false);
    expect(leakedSecret.success).toBe(false);
  });

  it("rejects provider URLs that can hide credentials in a query", () => {
    const provider = ProviderSchema.safeParse({
      schemaVersion: 1,
      id: `provider_${UUIDS.provider}`,
      slug: "unsafe-provider",
      displayName: "Unsafe provider",
      kind: "OTHER",
      category: "LLM_API",
      baseUrl: "https://example.test/v1?api_key=secret",
      isEnabled: true,
    });

    expect(provider.success).toBe(false);
  });

  it("defines versioned Skills, canonical Tools and explicit Agent assignments", () => {
    const skill = SkillSchema.parse({
      schemaVersion: 1,
      id: `skill_${UUIDS.skill}`,
      slug: "source-research",
      displayName: "Source research",
      version: "1.2.0",
      description: "Collect and verify primary sources.",
      sourceKind: "LOCAL_PATH",
      sourceRef: "skills/source-research/SKILL.md",
      integritySha256: "a".repeat(64),
      isEnabled: true,
    });
    const tool = ToolSchema.parse({
      schemaVersion: 1,
      id: `tool_${UUIDS.tool}`,
      slug: "browser-search",
      displayName: "Browser search",
      kind: "BROWSER",
      description: "Search primary public sources.",
      isEnabled: true,
    });
    const skillAssignment = AgentSkillAssignmentSchema.parse({
      schemaVersion: 1,
      agentId: `agent_${UUIDS.agent}`,
      skillId: skill.id,
      priority: 10,
      isEnabled: true,
    });
    const toolAssignment = AgentToolAssignmentSchema.parse({
      schemaVersion: 1,
      agentId: `agent_${UUIDS.agent}`,
      toolId: tool.id,
      isEnabled: true,
    });

    expect(skillAssignment.skillId).toBe(skill.id);
    expect(toolAssignment.toolId).toBe(tool.id);
  });

  it("allows Tool configuration references but never inline configuration secrets", () => {
    const referenced = ToolSchema.safeParse({
      schemaVersion: 1,
      id: `tool_${UUIDS.tool}`,
      slug: "database-read",
      displayName: "Database read",
      kind: "DATABASE",
      description: "Read the owner-approved database surface.",
      configurationRef: "vault:tools/database-read",
      isEnabled: true,
    });
    const inlineSecret = ToolSchema.safeParse({
      schemaVersion: 1,
      id: `tool_${UUIDS.tool}`,
      slug: "unsafe-database-read",
      displayName: "Unsafe database read",
      kind: "DATABASE",
      description: "Must not persist inline secrets.",
      configurationRef: "postgres://owner:secret@example.test/private",
      isEnabled: true,
    });

    expect(referenced.success).toBe(true);
    expect(inlineSecret.success).toBe(false);
  });

  it("models Project membership without making Project own Agent identity", () => {
    const project = ProjectSchema.parse({
      schemaVersion: 1,
      id: `project_${UUIDS.project}`,
      slug: "canonical-hub",
      name: "Canonical Hub",
      description: "Shared context for the Hub implementation.",
      isArchived: false,
      createdAt: "2026-08-13T12:00:00.000Z",
    });
    const membership = ProjectAgentMembershipSchema.parse({
      schemaVersion: 1,
      projectId: project.id,
      agentId: `agent_${UUIDS.agent}`,
      createdAt: "2026-08-13T12:01:00.000Z",
    });

    expect(membership.projectId).toBe(project.id);
    expect(project).not.toHaveProperty("agentId");
  });
});
