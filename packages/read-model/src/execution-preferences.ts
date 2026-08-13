import {
  AccountIdSchema,
  AgentIdSchema,
  CanonicalModelIdSchema,
  ExecutionModeSchema,
  ProjectIdSchema,
  RunIdSchema,
  TaskIdSchema,
} from "@agent-world/domain";
import * as z from "zod";

const PreferenceScopeSchema = z.discriminatedUnion("kind", [
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

const ExecutionPreferenceOverridesSchema = z.strictObject({
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
