import {
  AccountSchema,
  AgentSchema,
  CanonicalModelSchema,
  HubCommandIdSchema,
  ModelRouteSchema,
  ProjectSchema,
  ProviderSchema,
  SkillSchema,
  ToolSchema,
} from "@agent-world/domain";
import * as z from "zod";

const commandBase = {
  schemaVersion: z.literal(1),
  commandId: HubCommandIdSchema,
};

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

const AgentCreateCommandSchema = z.strictObject({
  ...commandBase,
  kind: z.literal("AGENT_CREATE"),
  agentId: AgentSchema.shape.id,
  slug: AgentSchema.shape.slug,
  displayName: AgentSchema.shape.displayName,
  role: AgentSchema.shape.role,
  instructions: AgentSchema.shape.instructions,
  preferredRouteId: AgentSchema.shape.preferredRouteId,
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
