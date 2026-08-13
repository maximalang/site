import * as z from "zod";
import {
  AccountIdSchema,
  AgentIdSchema,
  CanonicalModelIdSchema,
  ExecutionModeSchema,
  ModelRouteIdSchema,
  OpaqueExternalIdSchema,
  ProjectIdSchema,
  ProviderIdSchema,
  SkillIdSchema,
  ToolIdSchema,
} from "./identity.js";
import { TimestampSchema } from "./primitives.js";

const SlugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const ProviderBaseUrlSchema = z
  .url()
  .max(2_048)
  .refine(
    (value) => /^https?:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(value) && !/^https?:\/\/[^/]*@/.test(value),
    "Provider URL must be an HTTP(S) URL without credentials, a query, or a fragment",
  );

const CredentialReferenceSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^(?:env|secret-store|vault):[A-Za-z0-9][A-Za-z0-9._/-]*$/);

function unique<T>(values: T[]): boolean {
  return new Set(values).size === values.length;
}

export const ProviderKindSchema = z.enum([
  "OPENAI",
  "ANTHROPIC",
  "GOOGLE",
  "OPENROUTER",
  "XAI",
  "DEEPSEEK",
  "MISTRAL",
  "GROQ",
  "AZURE_OPENAI",
  "AWS_BEDROCK",
  "OLLAMA",
  "LM_STUDIO",
  "OPENCLAW",
  "CUSTOM_OPENAI_COMPATIBLE",
  "OTHER",
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const ProviderCategorySchema = z.enum([
  "LLM_API",
  "CONSUMER_ACCOUNT",
  "LOCAL_MODEL",
  "RUNTIME_GATEWAY",
]);
export type ProviderCategory = z.infer<typeof ProviderCategorySchema>;

export const ProviderSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: ProviderIdSchema,
  slug: SlugSchema,
  displayName: z.string().trim().min(1).max(100),
  kind: ProviderKindSchema,
  category: ProviderCategorySchema,
  baseUrl: ProviderBaseUrlSchema.optional(),
  isEnabled: z.boolean(),
});
export type Provider = z.infer<typeof ProviderSchema>;

export const AccountAuthMechanismSchema = z.enum([
  "API_KEY",
  "OAUTH",
  "CHATGPT_INTERACTIVE",
  "TOKEN",
  "DEVICE_TOKEN",
  "NONE",
]);
export type AccountAuthMechanism = z.infer<typeof AccountAuthMechanismSchema>;

export const AccountHealthSchema = z.enum([
  "ACTIVE",
  "DEGRADED",
  "EXHAUSTED",
  "DISABLED",
  "UNCONFIGURED",
]);
export type AccountHealth = z.infer<typeof AccountHealthSchema>;

export const AccountSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: AccountIdSchema,
  providerId: ProviderIdSchema,
  label: z.string().trim().min(1).max(100),
  authMechanism: AccountAuthMechanismSchema,
  subscription: z.string().trim().min(1).max(100).optional(),
  availableSurfaces: z.array(ExecutionModeSchema).max(6).refine(unique),
  health: AccountHealthSchema,
  credentialRef: CredentialReferenceSchema.optional(),
  lastSuccessfulAuthAt: TimestampSchema.optional(),
  isEnabled: z.boolean(),
  createdAt: TimestampSchema,
});
export type Account = z.infer<typeof AccountSchema>;

export const ModelModalitySchema = z.enum([
  "TEXT",
  "IMAGE_INPUT",
  "AUDIO_INPUT",
  "VIDEO_INPUT",
  "IMAGE_OUTPUT",
  "AUDIO_OUTPUT",
]);
export type ModelModality = z.infer<typeof ModelModalitySchema>;

export const CanonicalModelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: CanonicalModelIdSchema,
  slug: SlugSchema,
  displayName: z.string().trim().min(1).max(120),
  family: z.string().trim().min(1).max(100),
  capabilities: z.strictObject({
    reasoning: z.boolean(),
    toolUse: z.boolean(),
    modalities: z.array(ModelModalitySchema).min(1).max(6).refine(unique),
    contextWindowTokens: z.number().int().positive().max(100_000_000),
    maxOutputTokens: z.number().int().positive().max(10_000_000).optional(),
  }),
  isEnabled: z.boolean(),
});
export type CanonicalModel = z.infer<typeof CanonicalModelSchema>;

export const ModelRouteAvailabilitySchema = z.enum([
  "AVAILABLE",
  "DEGRADED",
  "UNAVAILABLE",
  "UNKNOWN",
]);
export type ModelRouteAvailability = z.infer<typeof ModelRouteAvailabilitySchema>;

export const ReasoningEffortSchema = z.enum(["MINIMAL", "LOW", "MEDIUM", "HIGH", "XHIGH"]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const ModelRouteSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: ModelRouteIdSchema,
  canonicalModelId: CanonicalModelIdSchema,
  providerId: ProviderIdSchema,
  accountId: AccountIdSchema.optional(),
  surface: ExecutionModeSchema,
  remoteModelId: OpaqueExternalIdSchema,
  availability: ModelRouteAvailabilitySchema,
  pricing: z
    .strictObject({
      currency: z.literal("USD"),
      inputPerMillion: z.number().nonnegative().finite(),
      outputPerMillion: z.number().nonnegative().finite(),
    })
    .optional(),
  limits: z
    .strictObject({
      requestsPerMinute: z.number().int().positive().optional(),
      tokensPerMinute: z.number().int().positive().optional(),
    })
    .optional(),
  latencyP50Ms: z.number().nonnegative().finite().optional(),
  qualityScore: z.number().min(0).max(100).finite().optional(),
  contextWindowTokens: z.number().int().positive().max(100_000_000),
  reasoningEfforts: z.array(ReasoningEffortSchema).max(5).refine(unique),
  supportedModalities: z.array(ModelModalitySchema).min(1).max(6).refine(unique),
  supportedToolIds: z.array(ToolIdSchema).max(100).refine(unique),
  isEnabled: z.boolean(),
});
export type ModelRoute = z.infer<typeof ModelRouteSchema>;

export const SkillSourceKindSchema = z.enum(["BUILTIN", "LOCAL_PATH", "GIT", "OPENCLAW"]);
export type SkillSourceKind = z.infer<typeof SkillSourceKindSchema>;

export const SkillSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: SkillIdSchema,
  slug: SlugSchema,
  displayName: z.string().trim().min(1).max(120),
  version: z
    .string()
    .max(64)
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  description: z.string().trim().min(1).max(2_000),
  sourceKind: SkillSourceKindSchema,
  sourceRef: OpaqueExternalIdSchema,
  integritySha256: z.string().regex(/^[a-f0-9]{64}$/),
  isEnabled: z.boolean(),
});
export type Skill = z.infer<typeof SkillSchema>;

export const ToolKindSchema = z.enum(["MCP", "HTTP", "CLI", "BROWSER", "DATABASE", "OTHER"]);
export type ToolKind = z.infer<typeof ToolKindSchema>;

export const ToolSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: ToolIdSchema,
  slug: SlugSchema,
  displayName: z.string().trim().min(1).max(120),
  kind: ToolKindSchema,
  description: z.string().trim().min(1).max(2_000),
  configurationRef: CredentialReferenceSchema.optional(),
  isEnabled: z.boolean(),
});
export type Tool = z.infer<typeof ToolSchema>;

export const AgentSkillAssignmentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  agentId: AgentIdSchema,
  skillId: SkillIdSchema,
  priority: z.number().int().min(0).max(1_000),
  isEnabled: z.boolean(),
});
export type AgentSkillAssignment = z.infer<typeof AgentSkillAssignmentSchema>;

export const AgentToolAssignmentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  agentId: AgentIdSchema,
  toolId: ToolIdSchema,
  isEnabled: z.boolean(),
});
export type AgentToolAssignment = z.infer<typeof AgentToolAssignmentSchema>;

export const ProjectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: ProjectIdSchema,
  slug: SlugSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(4_000).optional(),
  isArchived: z.boolean(),
  createdAt: TimestampSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectAgentMembershipSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  agentId: AgentIdSchema,
  createdAt: TimestampSchema,
});
export type ProjectAgentMembership = z.infer<typeof ProjectAgentMembershipSchema>;
