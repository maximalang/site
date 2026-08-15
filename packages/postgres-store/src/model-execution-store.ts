import { createHash } from "node:crypto";
import {
  type DurableModelExecutionStore,
  ModelGatewayResultSchema,
  type ModelTaskBindingResolver,
  type ModelTaskExecutionRequest,
  ModelTaskExecutionRequestSchema,
} from "@agent-world/model-gateway";
import type { QueryResultRow } from "pg";
import * as z from "zod";
import type { TransactionPool } from "./conversation-store.js";

const EXECUTION_DEADLINE_MS = 11 * 60_000;
const ExternalRunIdSchema = z
  .string()
  .regex(/^model_execution_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
type JobRow = QueryResultRow & {
  id: string;
  request_sha256: string;
  status: "EXECUTING" | "COMPLETED" | "FAILED";
  failure_code: string | null;
  accepted_at: Date | string;
  deadline_at: Date | string;
  completed_at: Date | string | null;
};
const iso = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

export class PostgresModelExecutionStore
  implements DurableModelExecutionStore, ModelTaskBindingResolver
{
  constructor(private readonly pool: TransactionPool) {}

  async resolve(input: { bindingId: string; agentId: string; adapterKind: string }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{
        route_id: string;
        model_route_id: string;
        mode: string;
      }>(
        `SELECT b.route_id, route.model_route_id, route.mode
           FROM agent_world.runtime_bindings b
           JOIN agent_world.execution_routes route
             ON route.id = b.route_id AND route.adapter_kind = b.adapter_kind
          WHERE b.id = $1 AND b.agent_id = $2 AND b.adapter_kind = $3
            AND b.is_enabled = true AND route.is_enabled = true
            AND route.model_route_id IS NOT NULL`,
        [input.bindingId, input.agentId, input.adapterKind],
      );
      if (result.rows.length !== 1 || !result.rows[0]) throw new Error("MODEL_BINDING_NOT_FOUND");
      return {
        routeId: result.rows[0].route_id,
        modelRouteId: result.rows[0].model_route_id,
        mode: result.rows[0].mode,
      };
    } finally {
      client.release();
    }
  }

  async prepare(
    requestValue: ModelTaskExecutionRequest,
    externalRunIdValue: string,
    acceptedAt: string,
  ) {
    const request = ModelTaskExecutionRequestSchema.parse(requestValue);
    const externalRunId = ExternalRunIdSchema.parse(externalRunIdValue);
    const requestHash = hash(request);
    const deadlineAt = new Date(Date.parse(acceptedAt) + EXECUTION_DEADLINE_MS).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        request.idempotencyKey,
      ]);
      const existing = await client.query<JobRow>(
        `SELECT id, request_sha256, status, failure_code, accepted_at, deadline_at, completed_at
           FROM agent_world.model_execution_jobs WHERE idempotency_key = $1`,
        [request.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_sha256 !== requestHash)
          throw new Error("MODEL_EXECUTION_IDEMPOTENCY_CONFLICT");
        await client.query("COMMIT");
        return {
          outcome: "REPLAY" as const,
          externalRunId: existing.rows[0].id,
          acceptedAt: iso(existing.rows[0].accepted_at),
        };
      }
      await client.query(
        `INSERT INTO agent_world.model_execution_jobs
           (id, run_id, task_id, agent_id, binding_id, session_id, route_id,
            model_route_id, adapter_kind, idempotency_key, request_sha256,
            status, accepted_at, deadline_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 'EXECUTING', $12, $13)`,
        [
          externalRunId,
          request.runId,
          request.taskId,
          request.agentId,
          request.bindingId,
          request.sessionId,
          request.routeId,
          request.modelRouteId,
          request.adapterKind,
          request.idempotencyKey,
          requestHash,
          acceptedAt,
          deadlineAt,
        ],
      );
      await client.query("COMMIT");
      return { outcome: "EXECUTE" as const, externalRunId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(externalRunIdValue: string, resultValue: unknown, completedAt: string) {
    const externalRunId = ExternalRunIdSchema.parse(externalRunIdValue);
    const result = ModelGatewayResultSchema.parse(resultValue);
    const client = await this.pool.connect();
    try {
      const updated = await client.query<{ id: string }>(
        `UPDATE agent_world.model_execution_jobs
            SET status = 'COMPLETED', result = $2::jsonb,
                input_tokens = $3, cached_input_tokens = $4, output_tokens = $5,
                cost_usd = $6, cost_source = $7, cost_estimated = $8, completed_at = $9
          WHERE id = $1 AND status = 'EXECUTING'
        RETURNING id`,
        [
          externalRunId,
          JSON.stringify(result),
          result.usage.inputTokens,
          result.usage.cachedInputTokens ?? 0,
          result.usage.outputTokens,
          result.monetaryCost?.amountUsd ?? null,
          result.monetaryCost?.source ?? null,
          result.monetaryCost?.estimated ?? null,
          completedAt,
        ],
      );
      if (updated.rows.length !== 1) throw new Error("MODEL_EXECUTION_NOT_EXECUTING");
    } finally {
      client.release();
    }
  }

  async fail(externalRunIdValue: string, failureCode: string, completedAt: string) {
    const externalRunId = ExternalRunIdSchema.parse(externalRunIdValue);
    const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).parse(failureCode);
    const client = await this.pool.connect();
    try {
      const updated = await client.query<{ id: string }>(
        `UPDATE agent_world.model_execution_jobs
            SET status = 'FAILED', failure_code = $2, completed_at = $3
          WHERE id = $1 AND status = 'EXECUTING' RETURNING id`,
        [externalRunId, code, completedAt],
      );
      if (updated.rows.length !== 1) throw new Error("MODEL_EXECUTION_NOT_EXECUTING");
    } finally {
      client.release();
    }
  }

  async observe(externalRunIdValue: string, observedAt: string) {
    const externalRunId = ExternalRunIdSchema.parse(externalRunIdValue);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<JobRow>(
        `SELECT id, request_sha256, status, failure_code, accepted_at, deadline_at, completed_at
           FROM agent_world.model_execution_jobs WHERE id = $1 FOR UPDATE`,
        [externalRunId],
      );
      const row = result.rows[0];
      if (!row) throw new Error("MODEL_EXECUTION_NOT_FOUND");
      if (row.status === "EXECUTING" && Date.parse(observedAt) >= Date.parse(iso(row.deadline_at))) {
        await client.query(
          `UPDATE agent_world.model_execution_jobs
              SET status = 'FAILED', failure_code = 'INTERRUPTED_OUTCOME_UNKNOWN', completed_at = $2
            WHERE id = $1`,
          [externalRunId, observedAt],
        );
        await client.query("COMMIT");
        return {
          status: "FAILED" as const,
          failureCode: "INTERRUPTED_OUTCOME_UNKNOWN",
          observedAt,
        };
      }
      await client.query("COMMIT");
      if (row.status === "EXECUTING") return { status: "RUNNING" as const, observedAt };
      if (row.status === "COMPLETED") {
        return { status: "COMPLETED" as const, observedAt: iso(row.completed_at ?? observedAt) };
      }
      return {
        status: "FAILED" as const,
        failureCode: row.failure_code ?? "UPSTREAM_UNAVAILABLE",
        observedAt: iso(row.completed_at ?? observedAt),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
