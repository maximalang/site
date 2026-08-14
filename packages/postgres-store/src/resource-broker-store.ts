import { createHash } from "node:crypto";
import {
  BrokerDecisionIdSchema,
  ExecutionModeSchema,
  RouteIdSchema,
  TaskIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import {
  type ResourceBrokerDecision,
  ResourceBrokerDecisionSchema,
  ResourceBrokerPolicySchema,
  ResourceRouteCandidateSchema,
  selectResourceRoute,
} from "@agent-world/read-model";
import type { QueryResultRow } from "pg";
import * as z from "zod";
import type { TransactionPool } from "./conversation-store.js";

const ObservationSchema = z.strictObject({
  routeId: RouteIdSchema,
  observedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  isAvailable: z.boolean(),
  quality: z.number().finite().min(0).max(1),
  remainingLimits: z.number().finite().min(0).max(1),
  cost: z.number().finite().min(0).max(1),
  speed: z.number().finite().min(0).max(1),
  load: z.number().finite().min(0).max(1),
  sourceKind: z.enum(["AUTH", "LAUNCHER", "HEALTHCHECK", "TELEMETRY", "OWNER"]),
  sourceRef: z.string().trim().min(1).max(512),
});

const DecideSchema = z.strictObject({
  decisionId: BrokerDecisionIdSchema,
  taskId: TaskIdSchema,
  policy: ResourceBrokerPolicySchema,
  decidedAt: TimestampSchema,
  allowedModes: z.array(ExecutionModeSchema).min(1).max(5).optional(),
});

type CandidateRow = QueryResultRow & {
  route_id: string;
  account_id: string | null;
  mode: string;
  adapter_kind: string;
  route_enabled: boolean;
  account_enabled: boolean | null;
  account_health: string | null;
  observed_at: Date | string;
  expires_at: Date | string;
  is_available: boolean;
  quality: string | number;
  remaining_limits: string | number;
  cost: string | number;
  speed: string | number;
  load: string | number;
};

type ExistingDecisionRow = QueryResultRow & {
  task_id: string;
  request_sha256: string;
  decision: unknown;
};

export type ResourceBrokerStoreErrorCode =
  | "ROUTE_NOT_FOUND"
  | "OBSERVATION_CONFLICT"
  | "DECISION_CONFLICT";

export class ResourceBrokerStoreError extends Error {
  constructor(readonly code: ResourceBrokerStoreErrorCode) {
    super(code);
    this.name = "ResourceBrokerStoreError";
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export class PostgresResourceBrokerStore {
  constructor(private readonly pool: TransactionPool) {}

  async recordObservation(input: z.input<typeof ObservationSchema>): Promise<void> {
    const observation = ObservationSchema.parse(input);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO agent_world.resource_route_observations
           (route_id, account_id, adapter_kind, mode, observed_at, expires_at,
            is_available, quality, remaining_limits, cost, speed, load,
            source_kind, source_ref)
         SELECT route.id, route.account_id, route.adapter_kind, route.mode, $2, $3,
                $4, $5, $6, $7, $8, $9, $10, $11
           FROM agent_world.execution_routes route
          WHERE route.id = $1
         ON CONFLICT (route_id, observed_at) DO NOTHING
         RETURNING route_id`,
        [
          observation.routeId,
          observation.observedAt,
          observation.expiresAt,
          observation.isAvailable,
          observation.quality,
          observation.remainingLimits,
          observation.cost,
          observation.speed,
          observation.load,
          observation.sourceKind,
          observation.sourceRef,
        ],
      );
      if (result.rows.length === 1) return;
      const route = await client.query("SELECT 1 FROM agent_world.execution_routes WHERE id = $1", [
        observation.routeId,
      ]);
      if (route.rows.length === 0) throw new ResourceBrokerStoreError("ROUTE_NOT_FOUND");
      throw new ResourceBrokerStoreError("OBSERVATION_CONFLICT");
    } finally {
      client.release();
    }
  }

  async decide(input: z.input<typeof DecideSchema>): Promise<ResourceBrokerDecision> {
    const request = DecideSchema.parse(input);
    const requestHash = sha256(request);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `agent_world:resource_broker:${request.decisionId}`,
      ]);
      const existing = await client.query<ExistingDecisionRow>(
        "SELECT task_id, request_sha256, decision FROM agent_world.resource_broker_decisions WHERE id = $1",
        [request.decisionId],
      );
      if (existing.rows[0]) {
        if (
          existing.rows.length !== 1 ||
          existing.rows[0].task_id !== request.taskId ||
          existing.rows[0].request_sha256 !== requestHash
        ) {
          throw new ResourceBrokerStoreError("DECISION_CONFLICT");
        }
        const decision = ResourceBrokerDecisionSchema.parse(existing.rows[0].decision);
        await client.query("COMMIT");
        return decision;
      }

      const candidates = await client.query<CandidateRow>(
        `SELECT DISTINCT ON (route.id)
                route.id AS route_id, route.account_id, route.mode, route.adapter_kind,
                route.is_enabled AS route_enabled,
                account.is_enabled AS account_enabled, account.health AS account_health,
                observation.observed_at, observation.expires_at, observation.is_available,
                observation.quality, observation.remaining_limits, observation.cost,
                observation.speed, observation.load
           FROM agent_world.execution_routes route
           JOIN agent_world.resource_route_observations observation
             ON observation.route_id = route.id
           LEFT JOIN agent_world.accounts account ON account.id = route.account_id
          WHERE ($1::text[] IS NULL OR route.mode = ANY($1::text[]))
          ORDER BY route.id, observation.observed_at DESC`,
        [request.allowedModes ?? null],
      );
      const decision = selectResourceRoute({
        policy: request.policy,
        now: request.decidedAt,
        candidates: candidates.rows.map((row) =>
          ResourceRouteCandidateSchema.parse({
            routeId: row.route_id,
            ...(row.account_id === null ? {} : { accountId: row.account_id }),
            mode: row.mode,
            adapterKind: row.adapter_kind,
            isAvailable:
              row.is_available &&
              row.route_enabled &&
              (row.account_id === null ||
                (row.account_enabled === true &&
                  ["ACTIVE", "DEGRADED"].includes(row.account_health ?? ""))),
            quality: Number(row.quality),
            remainingLimits: Number(row.remaining_limits),
            cost: Number(row.cost),
            speed: Number(row.speed),
            load: Number(row.load),
            observedAt: iso(row.observed_at),
            expiresAt: iso(row.expires_at),
          }),
        ),
      });
      const selectedEvaluation = decision.selected
        ? decision.evaluations.find(
            ({ candidate }) => candidate.routeId === decision.selected?.routeId,
          )
        : undefined;
      const payloadHash = sha256(decision);
      await client.query(
        `INSERT INTO agent_world.resource_broker_decisions
           (id, task_id, request_sha256, policy_version, decision, decision_sha256,
            selected_route_id, selected_account_id, selected_adapter_kind,
            selected_mode, selected_score, fallback_reason, decided_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          request.decisionId,
          request.taskId,
          requestHash,
          request.policy.version,
          JSON.stringify(decision),
          payloadHash,
          decision.selected?.routeId ?? null,
          decision.selected?.accountId ?? null,
          decision.selected?.adapterKind ?? null,
          decision.selected?.mode ?? null,
          selectedEvaluation?.score ?? null,
          decision.selected ? null : "NO_ELIGIBLE_ROUTE",
          request.decidedAt,
        ],
      );
      await client.query("COMMIT");
      return decision;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
