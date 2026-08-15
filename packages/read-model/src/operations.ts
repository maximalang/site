import {
  AgentIdSchema,
  EventIdSchema,
  RunIdSchema,
  TaskIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import * as z from "zod";

const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const UnitIntervalSchema = z.number().finite().min(0).max(1);

export const ActionGraphNodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("TASK"),
    id: TaskIdSchema,
    label: z.string().trim().min(1).max(200),
    agentId: AgentIdSchema,
    status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "FAILED"]),
    occurredAt: TimestampSchema,
  }),
  z.strictObject({
    kind: z.literal("RUN"),
    id: RunIdSchema,
    label: z.string().trim().min(1).max(200),
    taskId: TaskIdSchema,
    agentId: AgentIdSchema,
    status: z.enum(["DISPATCH_PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]),
    adapterKind: z.enum(["OPENCLAW", "CODEX", "NATIVE_CHATGPT"]),
    occurredAt: TimestampSchema,
    resultSummary: z.string().trim().min(1).max(2_000).optional(),
  }),
]);

export const ActionGraphEdgeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("EXECUTION"),
    fromTaskId: TaskIdSchema,
    toRunId: RunIdSchema,
  }),
  z.strictObject({
    kind: z.literal("HANDOFF"),
    id: EventIdSchema,
    fromTaskId: TaskIdSchema,
    toTaskId: TaskIdSchema,
    fromRunId: RunIdSchema,
    occurredAt: TimestampSchema,
  }),
]);

export const RouteSignalSchema = z.strictObject({
  routeId: z.string().regex(/^route_[0-9a-f-]{36}$/),
  isAvailable: z.boolean(),
  quality: UnitIntervalSchema,
  remainingLimits: UnitIntervalSchema,
  costEfficiency: UnitIntervalSchema,
  speed: UnitIntervalSchema,
  loadHeadroom: UnitIntervalSchema,
  observedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  isFresh: z.boolean(),
});

export const OperationsReadModelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: TimestampSchema,
  actionGraph: z.strictObject({
    nodes: z.array(ActionGraphNodeSchema).max(400),
    edges: z.array(ActionGraphEdgeSchema).max(800),
  }),
  observatory: z.strictObject({
    runs: z.strictObject({ total: CountSchema, completed: CountSchema, failed: CountSchema }),
    tokens: z.strictObject({
      input: CountSchema,
      cachedInput: CountSchema,
      output: CountSchema,
    }),
    context: z.strictObject({
      estimatedTokens: CountSchema,
      budgetTokens: CountSchema,
      pressure: UnitIntervalSchema,
    }),
    monetaryCost: z.strictObject({ status: z.literal("UNAVAILABLE") }),
    routeSignals: z.array(RouteSignalSchema).max(200),
  }),
});
export type OperationsReadModel = z.infer<typeof OperationsReadModelSchema>;
