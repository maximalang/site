import {
  AccountIdSchema,
  AgentIdSchema,
  CanonicalModelIdSchema,
  ExecutionModeSchema,
  ModelRouteIdSchema,
  ProjectIdSchema,
  ProviderIdSchema,
  RunIdSchema,
  TaskIdSchema,
} from "@agent-world/domain";
import * as z from "zod";

export const PreferenceScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("SYSTEM") }),
  z.strictObject({ kind: z.literal("PROJECT"), projectId: ProjectIdSchema }),
  z.strictObject({ kind: z.literal("AGENT"), agentId: AgentIdSchema }),
  z.strictObject({ kind: z.literal("TASK"), taskId: TaskIdSchema }),
  z.strictObject({ kind: z.literal("RUN"), runId: RunIdSchema }),
]);

const ModelPreferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("AUTO") }),
  z.strictObject({ kind: z.literal("MODEL"), modelId: CanonicalModelIdSchema }),
]);

const AccountPreferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("AUTO") }),
  z.strictObject({ kind: z.literal("ACCOUNT"), accountId: AccountIdSchema }),
]);

const ModePreferenceSchema = z.union([z.literal("AUTO"), ExecutionModeSchema]);
const ContextPreferenceSchema = z.enum(["AUTO", "LEAN", "BALANCED", "RICH"]);
const BudgetPreferenceSchema = z.enum(["AUTO", "ECONOMY", "BALANCED", "QUALITY"]);

export const ExecutionPreferenceOverridesSchema = z.strictObject({
  model: ModelPreferenceSchema.optional(),
  account: AccountPreferenceSchema.optional(),
  mode: ModePreferenceSchema.optional(),
  context: ContextPreferenceSchema.optional(),
  budget: BudgetPreferenceSchema.optional(),
});

export const ExecutionPreferenceLayerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scope: PreferenceScopeSchema,
  overrides: ExecutionPreferenceOverridesSchema,
});
export type ExecutionPreferenceLayer = z.infer<typeof ExecutionPreferenceLayerSchema>;

export const ResolvedExecutionPreferencesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  model: z.strictObject({ value: ModelPreferenceSchema, source: PreferenceScopeSchema }),
  account: z.strictObject({ value: AccountPreferenceSchema, source: PreferenceScopeSchema }),
  mode: z.strictObject({ value: ModePreferenceSchema, source: PreferenceScopeSchema }),
  context: z.strictObject({ value: ContextPreferenceSchema, source: PreferenceScopeSchema }),
  budget: z.strictObject({ value: BudgetPreferenceSchema, source: PreferenceScopeSchema }),
});
export type ResolvedExecutionPreferences = z.infer<typeof ResolvedExecutionPreferencesSchema>;

export const ExecutionPreferenceSelectionSchema = z
  .strictObject({
    projectId: ProjectIdSchema.optional(),
    agentId: AgentIdSchema.optional(),
    taskId: TaskIdSchema.optional(),
  })
  .refine((value) => value.taskId === undefined || (value.projectId && value.agentId), {
    message: "Task preference selection requires Project and Agent",
  });
export type ExecutionPreferenceSelection = z.infer<typeof ExecutionPreferenceSelectionSchema>;

export const ExecutionPreferenceReadModelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  selection: ExecutionPreferenceSelectionSchema,
  local: ExecutionPreferenceLayerSchema,
  resolved: ResolvedExecutionPreferencesSchema,
});
export type ExecutionPreferenceReadModel = z.infer<typeof ExecutionPreferenceReadModelSchema>;

export const ExecutionRouteCandidateSchema = z.strictObject({
  modelRouteId: ModelRouteIdSchema,
  modelId: CanonicalModelIdSchema,
  providerId: ProviderIdSchema,
  accountId: AccountIdSchema.optional(),
  mode: ExecutionModeSchema,
  availability: z.enum(["AVAILABLE", "DEGRADED", "UNAVAILABLE", "UNKNOWN"]),
  providerEnabled: z.boolean(),
  modelEnabled: z.boolean(),
  routeEnabled: z.boolean(),
  accountEnabled: z.boolean().optional(),
  accountHealth: z.enum(["ACTIVE", "DEGRADED", "EXHAUSTED", "DISABLED", "UNCONFIGURED"]).optional(),
});
export type ExecutionRouteCandidate = z.infer<typeof ExecutionRouteCandidateSchema>;

const availabilityRank = { AVAILABLE: 0, DEGRADED: 1 } as const;
const healthRank = { ACTIVE: 0, DEGRADED: 1 } as const;

export function eligibleExecutionRoutes(
  preferences: ResolvedExecutionPreferences,
  input: readonly ExecutionRouteCandidate[],
): ExecutionRouteCandidate[] {
  const resolved = ResolvedExecutionPreferencesSchema.parse(preferences);
  return input
    .map((candidate) => ExecutionRouteCandidateSchema.parse(candidate))
    .filter(
      (candidate) =>
        candidate.providerEnabled &&
        candidate.modelEnabled &&
        candidate.routeEnabled &&
        candidate.availability in availabilityRank &&
        (candidate.accountId === undefined ||
          (candidate.accountEnabled === true &&
            candidate.accountHealth !== undefined &&
            candidate.accountHealth in healthRank)) &&
        (resolved.model.value.kind === "AUTO" ||
          resolved.model.value.modelId === candidate.modelId) &&
        (resolved.account.value.kind === "AUTO" ||
          resolved.account.value.accountId === candidate.accountId) &&
        (resolved.mode.value === "AUTO" || resolved.mode.value === candidate.mode),
    )
    .sort((left, right) => {
      const availability =
        availabilityRank[left.availability as keyof typeof availabilityRank] -
        availabilityRank[right.availability as keyof typeof availabilityRank];
      if (availability !== 0) return availability;
      const leftHealth = left.accountHealth
        ? healthRank[left.accountHealth as keyof typeof healthRank]
        : 0;
      const rightHealth = right.accountHealth
        ? healthRank[right.accountHealth as keyof typeof healthRank]
        : 0;
      return leftHealth - rightHealth || left.modelRouteId.localeCompare(right.modelRouteId);
    });
}

const rank: Record<ExecutionPreferenceLayer["scope"]["kind"], number> = {
  SYSTEM: 0,
  PROJECT: 1,
  AGENT: 2,
  TASK: 3,
  RUN: 4,
};

export function resolveExecutionPreferences(
  input: readonly ExecutionPreferenceLayer[],
): ResolvedExecutionPreferences {
  const layers = input.map((layer) => ExecutionPreferenceLayerSchema.parse(layer));
  if (layers[0]?.scope.kind !== "SYSTEM") {
    throw new Error("Execution preferences require a System layer");
  }
  for (let index = 1; index < layers.length; index += 1) {
    const previous = layers[index - 1];
    const current = layers[index];
    if (!previous || !current || rank[previous.scope.kind] >= rank[current.scope.kind]) {
      throw new Error("Execution preference layers must be unique and ordered");
    }
  }
  const defaults = layers[0].overrides;
  if (
    defaults.model === undefined ||
    defaults.account === undefined ||
    defaults.mode === undefined ||
    defaults.context === undefined ||
    defaults.budget === undefined
  ) {
    throw new Error("System execution preferences must define every field");
  }

  const resolved: Record<string, { value: unknown; source: unknown }> = {};
  for (const layer of layers) {
    for (const key of ["model", "account", "mode", "context", "budget"] as const) {
      const value = layer.overrides[key];
      if (value !== undefined) resolved[key] = { value, source: layer.scope };
    }
  }
  return ResolvedExecutionPreferencesSchema.parse({ schemaVersion: 1, ...resolved });
}
