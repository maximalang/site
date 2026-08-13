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
export const BindingIdSchema = canonicalId("binding", "BindingId");
export const RouteIdSchema = canonicalId("route", "RouteId");
export const SessionIdSchema = canonicalId("session", "SessionId");

export type AccountId = z.infer<typeof AccountIdSchema>;
export type AgentId = z.infer<typeof AgentIdSchema>;
export type BindingId = z.infer<typeof BindingIdSchema>;
export type RouteId = z.infer<typeof RouteIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;

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
  isEnabled: z.boolean(),
});
export type ExecutionRoute = z.infer<typeof ExecutionRouteSchema>;

const ExternalRuntimeIdSchema = z
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
  externalAgentId: ExternalRuntimeIdSchema,
  isEnabled: z.boolean(),
});
export type RuntimeBinding = z.infer<typeof RuntimeBindingSchema>;
