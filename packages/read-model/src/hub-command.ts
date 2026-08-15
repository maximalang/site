import {
  AccountSchema,
  AgentSchema,
  AgentTemplateIdSchema,
  BindingIdSchema,
  CanonicalModelSchema,
  ConversationIdSchema,
  ExecutionRouteSchema,
  HubCommandIdSchema,
  MissionIdSchema,
  ModelRouteSchema,
  ProjectSchema,
  ProviderSchema,
  ReasoningEffortSchema,
  SessionIdSchema,
  SkillSchema,
  ToolSchema,
} from "@agent-world/domain";
import * as z from "zod";

const commandBase = {
  schemaVersion: z.literal(1),
  commandId: HubCommandIdSchema,
};

const ExternalRuntimeReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      [...value].every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint >= 32 && codePoint !== 127;
      }),
    "Runtime reference must not contain control characters",
  );

const ProviderCreateCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("PROVIDER_CREATE"),
  providerId: ProviderSchema.shape.id,
  slug: ProviderSchema.shape.slug,
  displayName: ProviderSchema.shape.displayName,
  providerKind: ProviderSchema.shape.kind,
  category: ProviderSchema.shape.category,
  baseUrl: ProviderSchema.shape.baseUrl,
});

const AccountCreateCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("ACCOUNT_CREATE"),
  accountId: AccountSchema.shape.id,
  providerId: AccountSchema.shape.providerId,
  label: AccountSchema.shape.label,
  authMechanism: AccountSchema.shape.authMechanism,
  subscription: AccountSchema.shape.subscription,
  availableSurfaces: AccountSchema.shape.availableSurfaces.min(1),
});

const CanonicalModelCreateCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("CANONICAL_MODEL_CREATE"),
  modelId: CanonicalModelSchema.shape.id,
  slug: CanonicalModelSchema.shape.slug,
  displayName: CanonicalModelSchema.shape.displayName,
  family: CanonicalModelSchema.shape.family,
  capabilities: CanonicalModelSchema.shape.capabilities,
});

const ModelRouteCreateCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("MODEL_ROUTE_CREATE"),
  modelRouteId: ModelRouteSchema.shape.id,
  canonicalModelId: ModelRouteSchema.shape.canonicalModelId,
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
});

const CodexRouteCreateCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("CODEX_ROUTE_CREATE"),
  routeId: ExecutionRouteSchema.shape.id,
  accountId: AccountSchema.shape.id,
  modelRouteId: ModelRouteSchema.shape.id,
  label: ExecutionRouteSchema.shape.label,
  reasoningEffort: ReasoningEffortSchema.optional(),
});

const ModelExecutionRouteCreateCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("MODEL_EXECUTION_ROUTE_CREATE"),
  routeId: ExecutionRouteSchema.shape.id,
  modelRouteId: ModelRouteSchema.shape.id,
  label: ExecutionRouteSchema.shape.label,
});

const AgentRouteBindCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("AGENT_ROUTE_BIND"),
  bindingId: BindingIdSchema,
  sessionId: SessionIdSchema,
  agentId: AgentSchema.shape.id,
  conversationId: ConversationIdSchema,
  routeId: ExecutionRouteSchema.shape.id,
  externalAgentId: ExternalRuntimeReferenceSchema,
  externalSessionRef: ExternalRuntimeReferenceSchema,
  startedAt: z.iso.datetime({ offset: true }),
});

const ModelAgentRouteProvisionCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("MODEL_AGENT_ROUTE_PROVISION"),
  routeId: ExecutionRouteSchema.shape.id,
  modelRouteId: ModelRouteSchema.shape.id,
  routeLabel: ExecutionRouteSchema.shape.label,
  bindingId: BindingIdSchema,
  sessionId: SessionIdSchema,
  agentId: AgentSchema.shape.id,
  projectId: ProjectSchema.shape.id,
  conversationId: ConversationIdSchema,
  conversationTitle: z.string().trim().min(1).max(160),
  externalAgentId: ExternalRuntimeReferenceSchema,
  externalSessionRef: ExternalRuntimeReferenceSchema,
  startedAt: z.iso.datetime({ offset: true }),
});

const AgentCreateCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("AGENT_CREATE"),
  agentId: AgentSchema.shape.id,
  slug: AgentSchema.shape.slug,
  displayName: AgentSchema.shape.displayName,
  role: AgentSchema.shape.role,
  instructions: AgentSchema.shape.instructions,
  preferredRouteId: AgentSchema.shape.preferredRouteId,
  provisioning: z
    .strictObject({
      templateId: AgentTemplateIdSchema,
      templateVersion: z.number().int().positive().max(1_000_000),
      projectId: ProjectSchema.shape.id,
      missionId: MissionIdSchema.optional(),
      skillIds: z
        .array(SkillSchema.shape.id)
        .max(500)
        .refine(
          (ids) => ids.every((id, index) => index === 0 || String(ids[index - 1]) < String(id)),
          "Skill IDs must be unique and sorted",
        ),
      toolIds: z
        .array(ToolSchema.shape.id)
        .max(500)
        .refine(
          (ids) => ids.every((id, index) => index === 0 || String(ids[index - 1]) < String(id)),
          "Tool IDs must be unique and sorted",
        ),
      preferences: z.strictObject({
        mode: z.enum(["AUTO", "CHAT", "WORK", "CODEX", "API", "LOCAL"]),
        context: z.enum(["AUTO", "LEAN", "BALANCED", "RICH"]),
        budget: z.enum(["AUTO", "ECONOMY", "BALANCED", "QUALITY"]),
      }),
    })
    .optional(),
});

const SkillCreateCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("SKILL_CREATE"),
  skillId: SkillSchema.shape.id,
  slug: SkillSchema.shape.slug,
  displayName: SkillSchema.shape.displayName,
  version: SkillSchema.shape.version,
  description: SkillSchema.shape.description,
  sourceKind: SkillSchema.shape.sourceKind,
  sourceRef: SkillSchema.shape.sourceRef,
  integritySha256: SkillSchema.shape.integritySha256,
});

const ToolCreateCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("TOOL_CREATE"),
  toolId: ToolSchema.shape.id,
  slug: ToolSchema.shape.slug,
  displayName: ToolSchema.shape.displayName,
  toolKind: ToolSchema.shape.kind,
  description: ToolSchema.shape.description,
});

const ProjectCreateCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("PROJECT_CREATE"),
  projectId: ProjectSchema.shape.id,
  slug: ProjectSchema.shape.slug,
  name: ProjectSchema.shape.name,
  description: ProjectSchema.shape.description,
});

export const HubCommandRequestSchema = z.discriminatedUnion("kind", [
  ProviderCreateCommandSchema,
  AccountCreateCommandSchema,
  CanonicalModelCreateCommandSchema,
  ModelRouteCreateCommandSchema,
  CodexRouteCreateCommandSchema,
  ModelExecutionRouteCreateCommandSchema,
  AgentRouteBindCommandSchema,
  ModelAgentRouteProvisionCommandSchema,
  AgentCreateCommandSchema,
  SkillCreateCommandSchema,
  ToolCreateCommandSchema,
  ProjectCreateCommandSchema,
]);
export type HubCommandRequest = z.infer<typeof HubCommandRequestSchema>;

const HubCommandResourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("PROVIDER"), id: ProviderSchema.shape.id }),
  z.strictObject({ kind: z.literal("ACCOUNT"), id: AccountSchema.shape.id }),
  z.strictObject({ kind: z.literal("CANONICAL_MODEL"), id: CanonicalModelSchema.shape.id }),
  z.strictObject({ kind: z.literal("MODEL_ROUTE"), id: ModelRouteSchema.shape.id }),
  z.strictObject({ kind: z.literal("EXECUTION_ROUTE"), id: ExecutionRouteSchema.shape.id }),
  z.strictObject({
    kind: z.literal("AGENT_ROUTE_BINDING"),
    id: BindingIdSchema,
    sessionId: SessionIdSchema,
  }),
  z.strictObject({
    kind: z.literal("MODEL_AGENT_ROUTE_CONNECTION"),
    id: BindingIdSchema,
    routeId: ExecutionRouteSchema.shape.id,
    conversationId: ConversationIdSchema,
    sessionId: SessionIdSchema,
  }),
  z.strictObject({ kind: z.literal("AGENT"), id: AgentSchema.shape.id }),
  z.strictObject({ kind: z.literal("SKILL"), id: SkillSchema.shape.id }),
  z.strictObject({ kind: z.literal("TOOL"), id: ToolSchema.shape.id }),
  z.strictObject({ kind: z.literal("PROJECT"), id: ProjectSchema.shape.id }),
]);

export const HubCommandResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(["CREATED", "REPLAY"]),
  commandId: HubCommandIdSchema,
  resource: HubCommandResourceSchema,
});
export type HubCommandResponse = z.infer<typeof HubCommandResponseSchema>;
