import { createHash } from "node:crypto";
import {
  type CodexExecutionEvent,
  CodexExecutionEventSchema,
  type CodexExecutionRequest,
  CodexExecutionRequestSchema,
} from "@agent-world/codex-adapter";
import { StructuredAgentOutputSchema, TimestampSchema } from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import * as z from "zod";
import type { TransactionPool } from "./conversation-store.js";

const ExecutionIdSchema = z
  .string()
  .regex(/^codex_execution_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

type ExistingJobRow = QueryResultRow & {
  id: string;
  request_sha256: string;
  accepted_at: Date | string;
};

type JobRow = QueryResultRow & {
  id: string;
  run_id: string;
  task_id: string;
  agent_id: string;
  binding_id: string;
  route_id: string;
  account_id: string;
  session_id: string;
  idempotency_key: string;
  codex_thread_id: string;
  prompt: string;
  working_directory: string;
  sandbox: string;
  approval_policy: string;
  network_access: boolean;
  timeout_ms: number;
  model: string | null;
  reasoning_effort: string | null;
  status: string;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  attempt: number;
  accepted_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  failure_code: string | null;
  final_output: string | null;
  input_tokens: number | string | null;
  cached_input_tokens: number | string | null;
  output_tokens: number | string | null;
  updated_at?: Date | string;
};

type ExistingEventRow = QueryResultRow & { event_sha256: string };
type SequenceRow = QueryResultRow & { last_sequence: number | string };
type LeaseRow = QueryResultRow & { id: string };

const WorkerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) =>
    [...value].every((character) => {
      const point = character.codePointAt(0);
      return point !== undefined && point > 31 && point !== 127;
    }),
  );
const LeaseDurationSchema = z.number().int().min(10_000).max(300_000);
const ObservationTimeoutSchema = z.number().int().min(0).max(30_000);

export type CodexExecutionStoreErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_EVENT"
  | "IDEMPOTENCY_CONFLICT"
  | "JOB_NOT_FOUND"
  | "LEASE_CONFLICT"
  | "EVENT_CONFLICT"
  | "PERSISTENCE_FAILED";

export class CodexExecutionStoreError extends Error {
  constructor(readonly code: CodexExecutionStoreErrorCode) {
    super(code);
    this.name = "CodexExecutionStoreError";
  }
}

const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);

function requestFingerprint(request: CodexExecutionRequest): string {
  return createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");
}

function eventFingerprint(event: CodexExecutionEvent): string {
  return createHash("sha256").update(JSON.stringify(event), "utf8").digest("hex");
}

function safeSequence(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
  }
  return parsed;
}

function requestFromRow(row: JobRow): CodexExecutionRequest {
  return CodexExecutionRequestSchema.parse({
    schemaVersion: 1,
    runId: row.run_id,
    taskId: row.task_id,
    agentId: row.agent_id,
    bindingId: row.binding_id,
    routeId: row.route_id,
    accountId: row.account_id,
    sessionId: row.session_id,
    codexThreadId: row.codex_thread_id,
    idempotencyKey: row.idempotency_key,
    prompt: row.prompt,
    policy: {
      workingDirectory: row.working_directory,
      sandbox: row.sandbox,
      approvalPolicy: row.approval_policy,
      networkAccess: row.network_access,
      timeoutMs: row.timeout_ms,
      ...(row.model === null ? {} : { model: row.model }),
      ...(row.reasoning_effort === null ? {} : { reasoningEffort: row.reasoning_effort }),
    },
  });
}

function eventValues(executionId: string, event: CodexExecutionEvent): unknown[] {
  return [
    executionId,
    event.sequence,
    event.eventType,
    event.occurredAt,
    eventFingerprint(event),
    "threadId" in event ? event.threadId : null,
    "upstreamTurnId" in event ? (event.upstreamTurnId ?? null) : null,
    "itemId" in event ? event.itemId : null,
    "itemType" in event ? event.itemType : null,
    "summary" in event ? (event.summary ?? null) : null,
    "content" in event ? event.content : null,
    "usage" in event ? event.usage.inputTokens : null,
    "usage" in event ? event.usage.cachedInputTokens : null,
    "usage" in event ? event.usage.outputTokens : null,
    "failureCode" in event ? event.failureCode : null,
  ];
}

const INSERT_EVENT_SQL = `INSERT INTO agent_world.codex_execution_events
  (execution_id, sequence, event_type, occurred_at, event_sha256, thread_id,
   upstream_turn_id, item_id, item_type, summary, content, input_tokens,
   cached_input_tokens, output_tokens, failure_code)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`;

export class PostgresCodexExecutionStore {
  private readonly executionId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly pool: TransactionPool,
    options: { executionId?: () => string; now?: () => string } = {},
  ) {
    this.executionId =
      options.executionId ??
      (() => {
        throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
      });
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async dispatch(requestValue: unknown) {
    const parsed = CodexExecutionRequestSchema.safeParse(requestValue);
    if (!parsed.success) throw new CodexExecutionStoreError("INVALID_REQUEST");
    const request = parsed.data;
    const executionId = ExecutionIdSchema.safeParse(this.executionId());
    const acceptedAt = TimestampSchema.safeParse(this.now());
    if (!executionId.success || !acceptedAt.success) {
      throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
    }
    const fingerprint = requestFingerprint(request);
    let client: Awaited<ReturnType<TransactionPool["connect"]>>;
    try {
      client = await this.pool.connect();
    } catch {
      throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
    }
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `agent_world:codex_execution:${request.idempotencyKey}`,
      ]);
      const existing = await client.query<ExistingJobRow>(
        `SELECT id, request_sha256, accepted_at
           FROM agent_world.codex_execution_jobs
          WHERE idempotency_key = $1 OR run_id = $2
          FOR UPDATE`,
        [request.idempotencyKey, request.runId],
      );
      if (
        existing.rows.length > 1 ||
        (existing.rows[0] && existing.rows[0].request_sha256 !== fingerprint)
      ) {
        throw new CodexExecutionStoreError("IDEMPOTENCY_CONFLICT");
      }
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return {
          acceptedAt: iso(existing.rows[0].accepted_at),
          externalRunId: ExecutionIdSchema.parse(existing.rows[0].id),
        };
      }
      await client.query(
        `INSERT INTO agent_world.codex_execution_jobs
           (id, idempotency_key, request_sha256, run_id, task_id, agent_id,
            binding_id, route_id, account_id, session_id, codex_thread_id,
            prompt, working_directory, sandbox, approval_policy, network_access,
            timeout_ms, model, reasoning_effort, status, accepted_at, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17, $18, $19, 'QUEUED', $20, $20, $20)`,
        [
          executionId.data,
          request.idempotencyKey,
          fingerprint,
          request.runId,
          request.taskId,
          request.agentId,
          request.bindingId,
          request.routeId,
          request.accountId,
          request.sessionId,
          request.codexThreadId,
          request.prompt,
          request.policy.workingDirectory,
          request.policy.sandbox,
          request.policy.approvalPolicy,
          request.policy.networkAccess,
          request.policy.timeoutMs,
          request.policy.model ?? null,
          request.policy.reasoningEffort ?? null,
          acceptedAt.data,
        ],
      );
      await client.query("COMMIT");
      return { acceptedAt: acceptedAt.data, externalRunId: executionId.data };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the bounded original error.
      }
      if (error instanceof CodexExecutionStoreError) throw error;
      throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
    } finally {
      client.release();
    }
  }

  async claim(workerIdValue: unknown, leaseMsValue: unknown) {
    const workerId = WorkerIdSchema.safeParse(workerIdValue);
    const leaseMs = LeaseDurationSchema.safeParse(leaseMsValue);
    const claimedAt = TimestampSchema.safeParse(this.now());
    if (!workerId.success || !leaseMs.success || !claimedAt.success) {
      throw new CodexExecutionStoreError("INVALID_REQUEST");
    }
    const leaseExpiresAt = new Date(Date.parse(claimedAt.data) + leaseMs.data).toISOString();
    const client = await this.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query<JobRow>(
        `WITH candidate AS (
           SELECT id
             FROM agent_world.codex_execution_jobs
            WHERE status = 'QUEUED'
            ORDER BY accepted_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE agent_world.codex_execution_jobs AS job
            SET status = 'LEASED', lease_owner = $1, lease_expires_at = $2,
                attempt = attempt + 1, updated_at = $3
           FROM candidate
          WHERE job.id = candidate.id
        RETURNING job.*`,
        [workerId.data, leaseExpiresAt, claimedAt.data],
      );
      if (claimed.rows.length > 1) throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
      await client.query("COMMIT");
      const row = claimed.rows[0];
      if (!row) return undefined;
      return {
        externalRunId: ExecutionIdSchema.parse(row.id),
        attempt: z.number().int().positive().max(10).parse(row.attempt),
        leaseExpiresAt: TimestampSchema.parse(iso(row.lease_expires_at as Date | string)),
        request: requestFromRow(row),
      };
    } catch (error) {
      await this.rollback(client);
      if (error instanceof CodexExecutionStoreError) throw error;
      throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
    } finally {
      client.release();
    }
  }

  async appendEvent(executionIdValue: unknown, workerIdValue: unknown, eventValue: unknown) {
    const executionId = ExecutionIdSchema.safeParse(executionIdValue);
    const workerId = WorkerIdSchema.safeParse(workerIdValue);
    const event = CodexExecutionEventSchema.safeParse(eventValue);
    const observedAt = TimestampSchema.safeParse(this.now());
    if (!executionId.success || !workerId.success || !event.success || !observedAt.success) {
      throw new CodexExecutionStoreError("INVALID_EVENT");
    }
    const fingerprint = eventFingerprint(event.data);
    const client = await this.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<JobRow>(
        `SELECT * FROM agent_world.codex_execution_jobs WHERE id = $1 FOR UPDATE`,
        [executionId.data],
      );
      if (found.rows.length !== 1 || !found.rows[0]) {
        throw new CodexExecutionStoreError("JOB_NOT_FOUND");
      }
      const existing = await client.query<ExistingEventRow>(
        `SELECT event_sha256
           FROM agent_world.codex_execution_events
          WHERE execution_id = $1 AND sequence = $2`,
        [executionId.data, event.data.sequence],
      );
      if (existing.rows.length > 1) throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
      if (existing.rows[0]) {
        if (existing.rows[0].event_sha256 !== fingerprint) {
          throw new CodexExecutionStoreError("EVENT_CONFLICT");
        }
        await client.query("COMMIT");
        return { outcome: "REPLAY" as const, sequence: event.data.sequence };
      }
      const row = found.rows[0];
      const eventTime = Date.parse(event.data.occurredAt);
      const observedTime = Date.parse(observedAt.data);
      const leaseExpiry =
        row.lease_expires_at === null ? Number.NaN : Date.parse(iso(row.lease_expires_at));
      const lastDurableTime = Date.parse(iso(row.updated_at ?? row.accepted_at));
      if (
        row.lease_owner !== workerId.data ||
        row.lease_expires_at === null ||
        leaseExpiry <= observedTime ||
        eventTime < lastDurableTime ||
        eventTime > observedTime ||
        eventTime >= leaseExpiry ||
        !["LEASED", "RUNNING"].includes(row.status)
      ) {
        throw new CodexExecutionStoreError("LEASE_CONFLICT");
      }
      if (
        (event.data.eventType === "RUN_STARTED" &&
          (row.status !== "LEASED" || event.data.threadId !== row.codex_thread_id)) ||
        (event.data.eventType !== "RUN_STARTED" &&
          event.data.eventType !== "RUN_FAILED" &&
          row.status !== "RUNNING")
      ) {
        throw new CodexExecutionStoreError("EVENT_CONFLICT");
      }
      const latest = await client.query<SequenceRow>(
        `SELECT COALESCE(max(sequence), 0) AS last_sequence
           FROM agent_world.codex_execution_events
          WHERE execution_id = $1`,
        [executionId.data],
      );
      const lastSequence = safeSequence(latest.rows[0]?.last_sequence ?? -1);
      if (event.data.sequence !== lastSequence + 1) {
        throw new CodexExecutionStoreError("EVENT_CONFLICT");
      }
      await client.query(INSERT_EVENT_SQL, eventValues(executionId.data, event.data));
      await this.applyEvent(client, executionId.data, workerId.data, event.data);
      await client.query("COMMIT");
      return { outcome: "APPLIED" as const, sequence: event.data.sequence };
    } catch (error) {
      await this.rollback(client);
      if (error instanceof CodexExecutionStoreError) throw error;
      throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
    } finally {
      client.release();
    }
  }

  async renewLease(executionIdValue: unknown, workerIdValue: unknown, leaseMsValue: unknown) {
    const executionId = ExecutionIdSchema.safeParse(executionIdValue);
    const workerId = WorkerIdSchema.safeParse(workerIdValue);
    const leaseMs = LeaseDurationSchema.safeParse(leaseMsValue);
    const renewedAt = TimestampSchema.safeParse(this.now());
    if (!executionId.success || !workerId.success || !leaseMs.success || !renewedAt.success) {
      throw new CodexExecutionStoreError("INVALID_REQUEST");
    }
    const leaseExpiresAt = new Date(Date.parse(renewedAt.data) + leaseMs.data).toISOString();
    const client = await this.connect();
    try {
      const renewed = await client.query<LeaseRow>(
        `UPDATE agent_world.codex_execution_jobs
            SET lease_expires_at = $4
          WHERE id = $1
            AND lease_owner = $2
            AND status IN ('LEASED', 'RUNNING')
            AND lease_expires_at > $3
        RETURNING id`,
        [executionId.data, workerId.data, renewedAt.data, leaseExpiresAt],
      );
      if (renewed.rows.length !== 1) throw new CodexExecutionStoreError("LEASE_CONFLICT");
      return { leaseExpiresAt };
    } catch (error) {
      if (error instanceof CodexExecutionStoreError) throw error;
      throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
    } finally {
      client.release();
    }
  }

  async recoverExpired() {
    const recoveredAt = TimestampSchema.safeParse(this.now());
    if (!recoveredAt.success) throw new CodexExecutionStoreError("INVALID_REQUEST");
    const client = await this.connect();
    try {
      await client.query("BEGIN");
      const expired = await client.query<JobRow>(
        `SELECT *
           FROM agent_world.codex_execution_jobs
          WHERE status IN ('LEASED', 'RUNNING')
            AND lease_expires_at <= $1
          ORDER BY lease_expires_at, id
          FOR UPDATE SKIP LOCKED`,
        [recoveredAt.data],
      );
      for (const row of expired.rows) {
        const latest = await client.query<SequenceRow>(
          `SELECT COALESCE(max(sequence), 0) AS last_sequence
             FROM agent_world.codex_execution_events
            WHERE execution_id = $1`,
          [row.id],
        );
        const event = CodexExecutionEventSchema.parse({
          schemaVersion: 1,
          sequence: safeSequence(latest.rows[0]?.last_sequence ?? -1) + 1,
          eventType: "RUN_FAILED",
          occurredAt: recoveredAt.data,
          failureCode: "WORKER_INTERRUPTED",
        });
        await client.query(INSERT_EVENT_SQL, eventValues(row.id, event));
        await client.query(
          `UPDATE agent_world.codex_execution_jobs
              SET status = 'FAILED', lease_owner = NULL, lease_expires_at = NULL,
                  completed_at = $2, failure_code = 'WORKER_INTERRUPTED', updated_at = $2
            WHERE id = $1`,
          [row.id, recoveredAt.data],
        );
      }
      await client.query("COMMIT");
      return { interrupted: expired.rows.length };
    } catch (error) {
      await this.rollback(client);
      if (error instanceof CodexExecutionStoreError) throw error;
      throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
    } finally {
      client.release();
    }
  }

  async observe(executionIdValue: unknown, timeoutMsValue: unknown) {
    const executionId = ExecutionIdSchema.safeParse(executionIdValue);
    const timeoutMs = ObservationTimeoutSchema.safeParse(timeoutMsValue);
    if (!executionId.success || !timeoutMs.success) {
      throw new CodexExecutionStoreError("INVALID_REQUEST");
    }
    const deadline = performance.now() + timeoutMs.data;
    let firstRead = true;
    while (firstRead || performance.now() < deadline) {
      firstRead = false;
      const client = await this.connect();
      try {
        const found = await client.query<JobRow>(
          `SELECT * FROM agent_world.codex_execution_jobs WHERE id = $1`,
          [executionId.data],
        );
        if (found.rows.length !== 1 || !found.rows[0]) {
          throw new CodexExecutionStoreError("JOB_NOT_FOUND");
        }
        const row = found.rows[0];
        const observedAt = iso(row.completed_at ?? row.updated_at ?? row.accepted_at);
        if (row.status === "COMPLETED") return { status: "COMPLETED" as const, observedAt };
        if (row.status === "FAILED") {
          return {
            status: "FAILED" as const,
            failureCode: row.failure_code ?? "EXECUTION_FAILED",
            observedAt,
          };
        }
        if (row.status === "CANCELLED") {
          return { status: "FAILED" as const, failureCode: "CANCELLED", observedAt };
        }
      } catch (error) {
        if (error instanceof CodexExecutionStoreError) throw error;
        throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
      } finally {
        client.release();
      }
      if (performance.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, timeoutMs.data)));
    }
    return { status: "RUNNING" as const, observedAt: TimestampSchema.parse(this.now()) };
  }

  private async connect() {
    try {
      return await this.pool.connect();
    } catch {
      throw new CodexExecutionStoreError("PERSISTENCE_FAILED");
    }
  }

  private async rollback(client: Awaited<ReturnType<TransactionPool["connect"]>>) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the bounded original error.
    }
  }

  private async applyEvent(
    client: Awaited<ReturnType<TransactionPool["connect"]>>,
    executionId: string,
    workerId: string,
    event: CodexExecutionEvent,
  ) {
    if (event.eventType === "RUN_STARTED") {
      await client.query(
        `UPDATE agent_world.codex_execution_jobs
            SET status = 'RUNNING', started_at = $3, updated_at = $3
          WHERE id = $1 AND lease_owner = $2`,
        [executionId, workerId, event.occurredAt],
      );
      return;
    }
    if (event.eventType === "FINAL_OUTPUT") {
      let structuredResult: unknown = null;
      let parseStatus = "RAW_FALLBACK";
      try {
        const parsed = StructuredAgentOutputSchema.safeParse(JSON.parse(event.content));
        if (parsed.success) {
          structuredResult = parsed.data;
          parseStatus = "VALIDATED";
        }
      } catch {
        // Raw bounded output remains canonical evidence when structured parsing fails.
      }
      await client.query(
        `UPDATE agent_world.codex_execution_jobs
            SET final_output = $3, structured_result = $4::jsonb,
                result_parse_status = $5, updated_at = $6
          WHERE id = $1 AND lease_owner = $2`,
        [executionId, workerId, event.content, structuredResult, parseStatus, event.occurredAt],
      );
      return;
    }
    if (event.eventType === "USAGE_RECORDED") {
      await client.query(
        `UPDATE agent_world.codex_execution_jobs
            SET input_tokens = $3, cached_input_tokens = $4, output_tokens = $5,
                updated_at = $6
          WHERE id = $1 AND lease_owner = $2`,
        [
          executionId,
          workerId,
          event.usage.inputTokens,
          event.usage.cachedInputTokens,
          event.usage.outputTokens,
          event.occurredAt,
        ],
      );
      return;
    }
    if (event.eventType === "RUN_COMPLETED") {
      await client.query(
        `UPDATE agent_world.codex_execution_jobs
            SET status = 'COMPLETED', lease_owner = NULL, lease_expires_at = NULL,
                completed_at = $3, updated_at = $3
          WHERE id = $1 AND lease_owner = $2`,
        [executionId, workerId, event.occurredAt],
      );
      return;
    }
    if (event.eventType === "RUN_FAILED") {
      await client.query(
        `UPDATE agent_world.codex_execution_jobs
            SET status = 'FAILED', lease_owner = NULL, lease_expires_at = NULL,
                completed_at = $3, failure_code = $4, updated_at = $3
          WHERE id = $1 AND lease_owner = $2`,
        [executionId, workerId, event.occurredAt, event.failureCode],
      );
      return;
    }
    await client.query(
      `UPDATE agent_world.codex_execution_jobs
          SET updated_at = $3
        WHERE id = $1 AND lease_owner = $2`,
      [executionId, workerId, event.occurredAt],
    );
  }
}
