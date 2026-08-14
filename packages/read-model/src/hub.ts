import {
  AccountSchema,
  AgentSchema,
  AgentSkillAssignmentSchema,
  AgentToolAssignmentSchema,
  CanonicalModelSchema,
  ExecutionRouteSchema,
  ModelRouteSchema,
  ProjectSchema,
  ProviderSchema,
  SkillSchema,
  TimestampSchema,
  ToolSchema,
  TransportDispatchModeSchema,
  TransportResultChannelSchema,
} from "@agent-world/domain";
import * as z from "zod";

export const HUB_READ_LIMITS = {
  providers: 100,
  accounts: 500,
  models: 1_000,
  modelRoutes: 5_000,
  executionRoutes: 1_000,
  agents: 500,
  skills: 1_000,
  tools: 1_000,
  projects: 1_000,
  assignments: 5_000,
  memberships: 5_000,
} as const;

function strictlyOrderedStrings(values: unknown[]): boolean {
  return values.every((value, index) => {
    const previous = values[index - 1];
    return (
      typeof value === "string" &&
      (index === 0 || (typeof previous === "string" && previous < value))
    );
  });
}

function strictlyOrderedBy(values: unknown[], key: string): boolean {
  return strictlyOrderedStrings(
    values.map((value) =>
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined,
    ),
  );
}

export const HubProviderSummarySchema = z.strictObject({
  providerId: ProviderSchema.shape.id,
  slug: ProviderSchema.shape.slug,
  displayName: ProviderSchema.shape.displayName,
  kind: ProviderSchema.shape.kind,
  category: ProviderSchema.shape.category,
  baseUrl: ProviderSchema.shape.baseUrl,
  isEnabled: ProviderSchema.shape.isEnabled,
});

export const HubAccountSummarySchema = z.strictObject({
  accountId: AccountSchema.shape.id,
  providerId: AccountSchema.shape.providerId,
  label: AccountSchema.shape.label,
  authMechanism: AccountSchema.shape.authMechanism,
  subscription: AccountSchema.shape.subscription,
  availableSurfaces: AccountSchema.shape.availableSurfaces,
  health: AccountSchema.shape.health,
  lastSuccessfulAuthAt: AccountSchema.shape.lastSuccessfulAuthAt,
  isEnabled: AccountSchema.shape.isEnabled,
  createdAt: AccountSchema.shape.createdAt,
});

export const HubModelRouteSummarySchema = z.strictObject({
  modelRouteId: ModelRouteSchema.shape.id,
  providerId: ModelRouteSchema.shape.providerId,
  accountId: ModelRouteSchema.shape.accountId,
  surface: ModelRouteSchema.shape.surface,
  remoteModelId: ModelRouteSchema.shape.remoteModelId,
  availability: ModelRouteSchema.shape.availability,
  pricing: ModelRouteSchema.shape.pricing,
  limits: ModelRouteSchema.shape.limits,
  latencyP50Ms: ModelRouteSchema.shape.latencyP50Ms,
  qualityScore: ModelRouteSchema.shape.qualityScore,
  contextWindowTokens: ModelRouteSchema.shape.contextWindowTokens,
  reasoningEfforts: ModelRouteSchema.shape.reasoningEfforts,
  supportedModalities: ModelRouteSchema.shape.supportedModalities,
  supportedToolIds: ModelRouteSchema.shape.supportedToolIds,
  isEnabled: ModelRouteSchema.shape.isEnabled,
});

export const HubCanonicalModelSummarySchema = z.strictObject({
  modelId: CanonicalModelSchema.shape.id,
  slug: CanonicalModelSchema.shape.slug,
  displayName: CanonicalModelSchema.shape.displayName,
  family: CanonicalModelSchema.shape.family,
  capabilities: CanonicalModelSchema.shape.capabilities,
  isEnabled: CanonicalModelSchema.shape.isEnabled,
  routes: z
    .array(HubModelRouteSummarySchema)
    .max(HUB_READ_LIMITS.modelRoutes)
    .refine(
      (routes) => strictlyOrderedBy(routes, "modelRouteId"),
      "ModelRoutes must be uniquely ordered by identity",
    ),
});

export const HubExecutionRouteSummarySchema = z.strictObject({
  routeId: ExecutionRouteSchema.shape.id,
  label: ExecutionRouteSchema.shape.label,
  mode: ExecutionRouteSchema.shape.mode,
  adapterKind: ExecutionRouteSchema.shape.adapterKind,
  accountId: ExecutionRouteSchema.shape.accountId,
  modelRouteId: ExecutionRouteSchema.shape.modelRouteId,
  isEnabled: ExecutionRouteSchema.shape.isEnabled,
});

export const HubTransportCapabilitySchema = z
  .strictObject({
    mode: z.enum(["CHAT", "WORK", "CODEX"]),
    support: z.enum(["OFFICIAL", "EXPERIMENTAL", "UNSUPPORTED", "DISABLED"]),
    dispatchMode: TransportDispatchModeSchema,
    resultChannel: TransportResultChannelSchema,
    contextMode: z.enum(["LAZY_PULL", "PUSH"]),
    selectable: z.boolean(),
    detail: z.string().trim().min(1).max(240),
  })
  .refine((capability) => capability.support !== "UNSUPPORTED" || !capability.selectable, {
    message: "Unsupported transports cannot be selected",
    path: ["selectable"],
  });

const HubAgentSkillAssignmentSchema = z.strictObject({
  skillId: AgentSkillAssignmentSchema.shape.skillId,
  priority: AgentSkillAssignmentSchema.shape.priority,
  isEnabled: AgentSkillAssignmentSchema.shape.isEnabled,
});

const HubAgentToolAssignmentSchema = z.strictObject({
  toolId: AgentToolAssignmentSchema.shape.toolId,
  isEnabled: AgentToolAssignmentSchema.shape.isEnabled,
});

export const HubAgentSummarySchema = z.strictObject({
  agentId: AgentSchema.shape.id,
  slug: AgentSchema.shape.slug,
  displayName: AgentSchema.shape.displayName,
  role: AgentSchema.shape.role,
  preferredRouteId: AgentSchema.shape.preferredRouteId,
  isEnabled: AgentSchema.shape.isEnabled,
  skillAssignments: z
    .array(HubAgentSkillAssignmentSchema)
    .max(HUB_READ_LIMITS.skills)
    .refine(
      (assignments) => strictlyOrderedBy(assignments, "skillId"),
      "Agent Skill assignments must be uniquely ordered by identity",
    ),
  toolAssignments: z
    .array(HubAgentToolAssignmentSchema)
    .max(HUB_READ_LIMITS.tools)
    .refine(
      (assignments) => strictlyOrderedBy(assignments, "toolId"),
      "Agent Tool assignments must be uniquely ordered by identity",
    ),
});

export const HubSkillSummarySchema = z.strictObject({
  skillId: SkillSchema.shape.id,
  slug: SkillSchema.shape.slug,
  displayName: SkillSchema.shape.displayName,
  version: SkillSchema.shape.version,
  description: SkillSchema.shape.description,
  sourceKind: SkillSchema.shape.sourceKind,
  integritySha256: SkillSchema.shape.integritySha256,
  isEnabled: SkillSchema.shape.isEnabled,
});

export const HubToolSummarySchema = z.strictObject({
  toolId: ToolSchema.shape.id,
  slug: ToolSchema.shape.slug,
  displayName: ToolSchema.shape.displayName,
  kind: ToolSchema.shape.kind,
  description: ToolSchema.shape.description,
  isEnabled: ToolSchema.shape.isEnabled,
});

export const HubProjectSummarySchema = z.strictObject({
  projectId: ProjectSchema.shape.id,
  slug: ProjectSchema.shape.slug,
  name: ProjectSchema.shape.name,
  description: ProjectSchema.shape.description,
  isArchived: ProjectSchema.shape.isArchived,
  createdAt: ProjectSchema.shape.createdAt,
  agentIds: z
    .array(AgentSchema.shape.id)
    .max(HUB_READ_LIMITS.agents)
    .refine(strictlyOrderedStrings, "Project Agent IDs must be uniquely ordered"),
});

export const HubReadModelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: TimestampSchema,
  providers: z
    .array(HubProviderSummarySchema)
    .max(HUB_READ_LIMITS.providers)
    .refine(
      (providers) => strictlyOrderedBy(providers, "providerId"),
      "Providers must be uniquely ordered",
    ),
  accounts: z
    .array(HubAccountSummarySchema)
    .max(HUB_READ_LIMITS.accounts)
    .refine(
      (accounts) => strictlyOrderedBy(accounts, "accountId"),
      "Accounts must be uniquely ordered",
    ),
  models: z
    .array(HubCanonicalModelSummarySchema)
    .max(HUB_READ_LIMITS.models)
    .refine((models) => strictlyOrderedBy(models, "modelId"), "Models must be uniquely ordered"),
  executionRoutes: z
    .array(HubExecutionRouteSummarySchema)
    .max(HUB_READ_LIMITS.executionRoutes)
    .refine(
      (routes) => strictlyOrderedBy(routes, "routeId"),
      "ExecutionRoutes must be uniquely ordered",
    ),
  transportCapabilities: z
    .array(HubTransportCapabilitySchema)
    .length(3)
    .refine(
      (capabilities) => capabilities.map(({ mode }) => mode).join(",") === "CHAT,WORK,CODEX",
      "Transport capabilities must contain Chat, Work and Codex exactly once",
    )
    .default([
      {
        mode: "CHAT",
        support: "EXPERIMENTAL",
        dispatchMode: "BROWSER_ON_DEMAND",
        resultChannel: "CONTROL_API",
        contextMode: "LAZY_PULL",
        selectable: false,
        detail:
          "Plus Chat launcher sends only run_id; backend commit integration is not live-verified.",
      },
      {
        mode: "WORK",
        support: "EXPERIMENTAL",
        dispatchMode: "SERVER_API",
        resultChannel: "CONTROL_API",
        contextMode: "LAZY_PULL",
        selectable: false,
        detail:
          "Workspace Agents API is official; result callback integration is not live-verified.",
      },
      {
        mode: "CODEX",
        support: "OFFICIAL",
        dispatchMode: "LOCAL_PROCESS",
        resultChannel: "PROCESS_IO",
        contextMode: "PUSH",
        selectable: true,
        detail: "Official Codex SDK and CLI transport; route readiness is enforced separately.",
      },
    ]),
  agents: z
    .array(HubAgentSummarySchema)
    .max(HUB_READ_LIMITS.agents)
    .refine((agents) => strictlyOrderedBy(agents, "agentId"), "Agents must be uniquely ordered"),
  skills: z
    .array(HubSkillSummarySchema)
    .max(HUB_READ_LIMITS.skills)
    .refine((skills) => strictlyOrderedBy(skills, "skillId"), "Skills must be uniquely ordered"),
  tools: z
    .array(HubToolSummarySchema)
    .max(HUB_READ_LIMITS.tools)
    .refine((tools) => strictlyOrderedBy(tools, "toolId"), "Tools must be uniquely ordered"),
  projects: z
    .array(HubProjectSummarySchema)
    .max(HUB_READ_LIMITS.projects)
    .refine(
      (projects) => strictlyOrderedBy(projects, "projectId"),
      "Projects must be uniquely ordered",
    ),
});
export type HubReadModel = z.infer<typeof HubReadModelSchema>;
