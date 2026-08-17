import {
  AccountIdSchema,
  ExecutionAdapterKindSchema,
  ExecutionModeSchema,
  getChatWorkTransportCapability,
  RouteIdSchema,
  TimestampSchema,
  TransportSupportStatusSchema,
} from "@agent-world/domain";
import * as z from "zod";

const UnitIntervalSchema = z.number().finite().min(0).max(1);

export const ResourceBrokerWeightsSchema = z
  .strictObject({
    quality: UnitIntervalSchema,
    remainingLimits: UnitIntervalSchema,
    cost: UnitIntervalSchema,
    speed: UnitIntervalSchema,
    load: UnitIntervalSchema,
  })
  .refine(
    (weights) =>
      Math.abs(
        weights.quality + weights.remainingLimits + weights.cost + weights.speed + weights.load - 1,
      ) < 1e-9,
    "Resource Broker weights must sum to one",
  );

export const ResourceBrokerPolicySchema = z.strictObject({
  version: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  weights: ResourceBrokerWeightsSchema,
});

const validTransportModes = {
  OPENCLAW: ["CHAT", "WORK"],
  CODEX: ["CODEX"],
  API_MODEL: ["API"],
  LOCAL_MODEL: ["LOCAL"],
  NATIVE_CHATGPT: ["CHAT"],
  NATIVE_WORK: ["WORK"],
} as const;

export const ResourceRouteCandidateSchema = z
  .strictObject({
    routeId: RouteIdSchema,
    accountId: AccountIdSchema.optional(),
    mode: ExecutionModeSchema,
    adapterKind: ExecutionAdapterKindSchema,
    isAvailable: z.boolean(),
    quality: UnitIntervalSchema,
    remainingLimits: UnitIntervalSchema,
    cost: UnitIntervalSchema,
    speed: UnitIntervalSchema,
    load: UnitIntervalSchema,
    observedAt: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .superRefine((candidate, context) => {
    if (
      !(validTransportModes[candidate.adapterKind] as readonly string[]).includes(candidate.mode)
    ) {
      context.addIssue({ code: "custom", message: "Route mode does not match its adapter" });
    }
    if (Date.parse(candidate.expiresAt) <= Date.parse(candidate.observedAt)) {
      context.addIssue({
        code: "custom",
        message: "Route observation expiry must follow observation",
      });
    }
    if (
      ["NATIVE_CHATGPT", "NATIVE_WORK", "CODEX", "API_MODEL"].includes(candidate.adapterKind) &&
      candidate.accountId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Account-backed routes require Account provenance",
      });
    }
  });
export type ResourceRouteCandidate = z.infer<typeof ResourceRouteCandidateSchema>;

export const ResourceBrokerEvaluationSchema = z.strictObject({
  candidate: ResourceRouteCandidateSchema,
  score: UnitIntervalSchema.optional(),
  transportSupportStatus: TransportSupportStatusSchema.optional(),
  exclusion: z.enum(["UNAVAILABLE", "STALE_OBSERVATION", "TRANSPORT_NOT_SELECTABLE"]).optional(),
});

export const ResourceBrokerDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  policy: ResourceBrokerPolicySchema,
  decidedAt: TimestampSchema,
  evaluations: z.array(ResourceBrokerEvaluationSchema).max(1_000),
  selected: ResourceRouteCandidateSchema.optional(),
});
export type ResourceBrokerDecision = z.infer<typeof ResourceBrokerDecisionSchema>;

const SelectionInputSchema = z.strictObject({
  policy: ResourceBrokerPolicySchema,
  now: TimestampSchema,
  candidates: z.array(ResourceRouteCandidateSchema).max(1_000),
});

function roundedScore(
  candidate: ResourceRouteCandidate,
  weights: z.infer<typeof ResourceBrokerWeightsSchema>,
) {
  const score =
    candidate.quality * weights.quality +
    candidate.remainingLimits * weights.remainingLimits +
    candidate.cost * weights.cost +
    candidate.speed * weights.speed +
    candidate.load * weights.load;
  return Math.round(score * 1_000_000) / 1_000_000;
}

export function selectResourceRoute(
  input: z.input<typeof SelectionInputSchema>,
): ResourceBrokerDecision {
  const parsed = SelectionInputSchema.parse(input);
  const now = Date.parse(parsed.now);
  const routeIds = new Set<string>();
  const evaluations = [...parsed.candidates]
    .sort((left, right) => left.routeId.localeCompare(right.routeId))
    .map((candidate) => {
      if (routeIds.has(candidate.routeId)) {
        throw new Error("Resource Broker candidates must be unique");
      }
      routeIds.add(candidate.routeId);
      const transportCapability = getChatWorkTransportCapability(candidate.adapterKind);
      if (transportCapability && !transportCapability.selectable) {
        return {
          candidate,
          transportSupportStatus: transportCapability.status,
          exclusion: "TRANSPORT_NOT_SELECTABLE" as const,
        };
      }
      const transportStatus = transportCapability
        ? { transportSupportStatus: transportCapability.status }
        : {};
      if (!candidate.isAvailable) {
        return { candidate, ...transportStatus, exclusion: "UNAVAILABLE" as const };
      }
      if (Date.parse(candidate.expiresAt) <= now) {
        return { candidate, ...transportStatus, exclusion: "STALE_OBSERVATION" as const };
      }
      return {
        candidate,
        ...transportStatus,
        score: roundedScore(candidate, parsed.policy.weights),
      };
    });
  const selected = evaluations
    .filter(
      (evaluation): evaluation is typeof evaluation & { score: number } =>
        "score" in evaluation && evaluation.score !== undefined,
    )
    .sort(
      (left, right) =>
        right.score - left.score || left.candidate.routeId.localeCompare(right.candidate.routeId),
    )[0]?.candidate;

  return ResourceBrokerDecisionSchema.parse({
    schemaVersion: 1,
    policy: parsed.policy,
    decidedAt: parsed.now,
    evaluations,
    ...(selected === undefined ? {} : { selected }),
  });
}
