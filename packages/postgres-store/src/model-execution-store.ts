import { createHash, randomUUID } from "node:crypto";
import {
  ContextItemIdSchema,
  EventIdSchema,
  MemoryProposalIdSchema,
  StructuredAgentOutputSchema,
} from "@agent-world/domain";
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
  private readonly contextItemId: () => string;
  private readonly memoryProposalId: () => string;
  private readonly memoryEventId: () => string;

  constructor(
    private readonly pool: TransactionPool,
    ids: {
      contextItemId?: () => string;
      memoryProposalId?: () => string;
      memoryEventId?: () => string;
    } = {},
  ) {
    this.contextItemId = ids.contextItemId ?? (() => `context_item_${randomUUID()}`);
    this.memoryProposalId = ids.memoryProposalId ?? (() => `memory_proposal_${randomUUID()}`);
    this.memoryEventId = ids.memoryEventId ?? (() => `event_${randomUUID()}`);
  }

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
      await client.query("BEGIN");
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
      let structuredResult: ReturnType<typeof StructuredAgentOutputSchema.parse> | undefined;
      try {
        const parsed = StructuredAgentOutputSchema.safeParse(JSON.parse(result.content));
        if (parsed.success) structuredResult = parsed.data;
      } catch {
        // Raw result remains canonical evidence; only validated output enters shared context.
      }
      if (structuredResult) {
        await this.materializeStructuredResult(
          client,
          externalRunId,
          structuredResult,
          completedAt,
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async materializeStructuredResult(
    client: Awaited<ReturnType<TransactionPool["connect"]>>,
    externalRunId: string,
    result: ReturnType<typeof StructuredAgentOutputSchema.parse>,
    occurredAt: string,
  ) {
    const provenance = await client.query<{
      run_id: string;
      task_id: string;
      agent_id: string;
      project_id: string;
    }>(
      `SELECT job.run_id, job.task_id, job.agent_id, task.project_id
         FROM agent_world.model_execution_jobs job
         JOIN agent_world.tasks task ON task.id = job.task_id
        WHERE job.id = $1`,
      [externalRunId],
    );
    const row = provenance.rows[0];
    if (!row) throw new Error("MODEL_EXECUTION_NOT_FOUND");
    const contextItemId = ContextItemIdSchema.parse(this.contextItemId());
    const summaryHash = hash(result.summary);
    const context = await client.query<{ id: string }>(
      `INSERT INTO agent_world.context_items
         (id, project_id, kind, temperature, content, summary, content_sha256,
          estimated_tokens, importance, provenance_kind, run_id, agent_id, task_id, created_at)
       VALUES ($1, $2, 'AGENT_RESULT', 'HOT', $3, $3, $4, $5, $6,
               'RUN', $7, $8, $9, $10)
       ON CONFLICT (project_id, kind, content_sha256, provenance_kind,
                    event_id, message_id, run_id, artifact_id, document_chunk_id)
       DO NOTHING RETURNING id`,
      [
        contextItemId,
        row.project_id,
        result.summary,
        summaryHash,
        Math.max(1, Math.min(100_000, Math.ceil(result.summary.length / 4))),
        result.confidence,
        row.run_id,
        row.agent_id,
        row.task_id,
        occurredAt,
      ],
    );
    if (!context.rows[0]) return;
    for (const candidate of result.memoryCandidates) {
      const proposalId = MemoryProposalIdSchema.parse(this.memoryProposalId());
      const contentHash = hash(candidate.statement);
      const request = {
        projectId: row.project_id,
        sourceContextItemId: contextItemId,
        content: candidate.statement,
        contentHash,
        importance: candidate.importance,
        createdAt: occurredAt,
      };
      const proposal = await client.query<{ id: string }>(
        `INSERT INTO agent_world.memory_proposals
           (id, project_id, source_context_item_id, content, content_sha256,
            estimated_tokens, importance, status, request_sha256, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9)
         ON CONFLICT (project_id, source_context_item_id, content_sha256) DO NOTHING
         RETURNING id`,
        [
          proposalId,
          row.project_id,
          contextItemId,
          candidate.statement,
          contentHash,
          Math.max(1, Math.min(10_000, Math.ceil(candidate.statement.length / 4))),
          candidate.importance,
          hash(request),
          occurredAt,
        ],
      );
      if (!proposal.rows[0]) continue;
      await client.query(
        `INSERT INTO agent_world.memory_events
           (id, event_type, project_id, proposal_id, source_context_item_id,
            content, payload_sha256, occurred_at)
         VALUES ($1, 'MEMORY_PROPOSED', $2, $3, $4, $5, $6, $7)`,
        [
          EventIdSchema.parse(this.memoryEventId()),
          row.project_id,
          proposalId,
          contextItemId,
          candidate.statement,
          hash({ eventType: "MEMORY_PROPOSED", request }),
          occurredAt,
        ],
      );
    }
  }

  async fail(externalRunIdValue: string, failureCode: string, completedAt: string) {
    const externalRunId = ExternalRunIdSchema.parse(externalRunIdValue);
    const code = z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .parse(failureCode);
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
      if (
        row.status === "EXECUTING" &&
        Date.parse(observedAt) >= Date.parse(iso(row.deadline_at))
      ) {
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
