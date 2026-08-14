import * as z from "zod";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function canonicalId<const Brand extends string>(prefix: string, brand: Brand) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_${UUID}$`), `Expected ${prefix}_ followed by a lowercase UUID`)
    .brand(brand);
}

export const AccountIdSchema = canonicalId("account", "AccountId");
export const AgentIdSchema = canonicalId("agent", "AgentId");
export const ApprovalIdSchema = canonicalId("approval", "ApprovalId");
export const ArtifactIdSchema = canonicalId("artifact", "ArtifactId");
export const BindingIdSchema = canonicalId("binding", "BindingId");
export const ChatDispatchIdSchema = canonicalId("chat_dispatch", "ChatDispatchId");
export const ConversationIdSchema = canonicalId("conversation", "ConversationId");
export const ContextItemIdSchema = canonicalId("context_item", "ContextItemId");
export const ContextPackIdSchema = canonicalId("context_pack", "ContextPackId");
export const DocumentIdSchema = canonicalId("document", "DocumentId");
export const DocumentChunkIdSchema = canonicalId("document_chunk", "DocumentChunkId");
export const EventIdSchema = canonicalId("event", "EventId");
export const HubCommandIdSchema = canonicalId("hub_command", "HubCommandId");
export const MessageIdSchema = canonicalId("message", "MessageId");
export const CanonicalModelIdSchema = canonicalId("model", "CanonicalModelId");
export const ModelRouteIdSchema = canonicalId("model_route", "ModelRouteId");
export const ProjectIdSchema = canonicalId("project", "ProjectId");
export const ProviderIdSchema = canonicalId("provider", "ProviderId");
export const RouteIdSchema = canonicalId("route", "RouteId");
export const RunIdSchema = canonicalId("run", "RunId");
export const SessionIdSchema = canonicalId("session", "SessionId");
export const SkillIdSchema = canonicalId("skill", "SkillId");
export const TaskIdSchema = canonicalId("task", "TaskId");
export const ToolIdSchema = canonicalId("tool", "ToolId");

export type AccountId = z.infer<typeof AccountIdSchema>;
export type AgentId = z.infer<typeof AgentIdSchema>;
export type ApprovalId = z.infer<typeof ApprovalIdSchema>;
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
export type BindingId = z.infer<typeof BindingIdSchema>;
export type ChatDispatchId = z.infer<typeof ChatDispatchIdSchema>;
export type ConversationId = z.infer<typeof ConversationIdSchema>;
export type ContextItemId = z.infer<typeof ContextItemIdSchema>;
export type ContextPackId = z.infer<typeof ContextPackIdSchema>;
export type DocumentId = z.infer<typeof DocumentIdSchema>;
export type DocumentChunkId = z.infer<typeof DocumentChunkIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type HubCommandId = z.infer<typeof HubCommandIdSchema>;
export type MessageId = z.infer<typeof MessageIdSchema>;
export type CanonicalModelId = z.infer<typeof CanonicalModelIdSchema>;
export type ModelRouteId = z.infer<typeof ModelRouteIdSchema>;
export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type ProviderId = z.infer<typeof ProviderIdSchema>;
export type RouteId = z.infer<typeof RouteIdSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;
export type SkillId = z.infer<typeof SkillIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
export type ToolId = z.infer<typeof ToolIdSchema>;

export const ExecutionModeSchema = z.enum(["CHAT", "WORK", "CODEX", "API", "LOCAL"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const ExecutionAdapterKindSchema = z.enum([
  "OPENCLAW",
  "CODEX",
  "API_MODEL",
  "LOCAL_MODEL",
  "NATIVE_CHATGPT",
  "NATIVE_WORK",
]);
export type ExecutionAdapterKind = z.infer<typeof ExecutionAdapterKindSchema>;

export const AgentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: AgentIdSchema,
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  displayName: z.string().trim().min(1).max(100),
  role: z.string().trim().min(1).max(160),
  instructions: z.string().trim().min(1).max(32_000),
  preferredRouteId: RouteIdSchema.optional(),
  isEnabled: z.boolean(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const AccountRefSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: AccountIdSchema,
  label: z.string().trim().min(1).max(100),
});
export type AccountRef = z.infer<typeof AccountRefSchema>;

export const ExecutionRouteSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: RouteIdSchema,
  label: z.string().trim().min(1).max(100),
  mode: ExecutionModeSchema,
  adapterKind: ExecutionAdapterKindSchema,
  accountId: AccountIdSchema.optional(),
  modelRouteId: ModelRouteIdSchema.optional(),
  isEnabled: z.boolean(),
});
export type ExecutionRoute = z.infer<typeof ExecutionRouteSchema>;

export const OpaqueExternalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      [...value].every((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
      }),
    "Control characters are not allowed",
  );

export const RuntimeBindingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: BindingIdSchema,
  agentId: AgentIdSchema,
  routeId: RouteIdSchema,
  adapterKind: ExecutionAdapterKindSchema,
  externalAgentId: OpaqueExternalIdSchema,
  isEnabled: z.boolean(),
});
export type RuntimeBinding = z.infer<typeof RuntimeBindingSchema>;
