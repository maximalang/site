import {
  AgentIdSchema,
  BindingIdSchema,
  EventIdSchema,
  ExecutionAdapterKindSchema,
  OpaqueExternalIdSchema,
  type Run,
  RunIdSchema,
  RunSchema,
  SessionIdSchema,
  TaskIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import * as z from "zod";
import type { TransactionPool } from "./conversation-store.js";

const MarkRunningSchema = z.strictObject({
  runId: RunIdSchema,
  externalRunId: OpaqueExternalIdSchema,
  startedAt: TimestampSchema,
});

type DispatchRow = QueryResultRow & {
  id: string;
  task_id: string;
  agent_id: string;
  approval_id: string;
  adapter_kind: string;
  binding_id: string;
  session_id: string;
  status: string;
  attempt: number;
  dispatch_idempotency_key: string;
  external_run_id: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  failure_code: string | null;
  title?: string;
  description?: string | null;
  external_agent_id?: string;
  external_session_ref?: string;
  binding_is_enabled?: boolean;
  session_ended_at?: Date | string | null;
};

type SequenceRow = QueryResultRow & { last_sequence: string | number };

export type RunDispatchStoreErrorCode =
  | "RUN_NOT_FOUND"
  | "ROUTE_UNAVAILABLE"
  | "RUN_NOT_PENDING"
  | "RECEIPT_CONFLICT";

export class RunDispatchStoreError extends Error {
  constructor(readonly code: RunDispatchStoreErrorCode) {
    super(code);
    this.name = "RunDispatchStoreError";
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseRun(row: DispatchRow): Run {
  return RunSchema.parse({
    schemaVersion: 1,
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id,
    approvalId: row.approval_id,
    adapterKind: row.adapter_kind,
    bindingId: row.binding_id,
    sessionId: row.session_id,
    status: row.status,
    attempt: row.attempt,
    dispatchIdempotencyKey: row.dispatch_idempotency_key,
    ...(row.external_run_id === null ? {} : { externalRunId: row.external_run_id }),
    createdAt: iso(row.created_at),
    ...(row.started_at === null ? {} : { startedAt: iso(row.started_at) }),
    ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }),
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
  });
}

function safeSequence(input: string | number): number {
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("World event sequence exceeds the safe read-model range");
  }
  return value;
}

const SELECT_RUN = `SELECT r.id, r.task_id, r.agent_id, r.approval_id, r.adapter_kind,
       r.binding_id, r.session_id, r.status, r.attempt, r.dispatch_idempotency_key,
       r.external_run_id, r.created_at, r.started_at, r.completed_at, r.failure_code,
       t.title, t.description, b.external_agent_id, b.is_enabled AS binding_is_enabled,
       s.external_session_ref, s.ended_at AS session_ended_at
  FROM agent_world.runs r
  JOIN agent_world.tasks t ON t.id = r.task_id AND t.assignee_agent_id = r.agent_id
  JOIN agent_world.runtime_bindings b
    ON b.id = r.binding_id AND b.agent_id = r.agent_id AND b.adapter_kind = r.adapter_kind
  JOIN agent_world.conversation_sessions s
    ON s.id = r.session_id AND s.agent_id = r.agent_id AND s.conversation_id = r.conversation_id
 WHERE r.id = $1`;

export class PostgresRunDispatchStore {
  private readonly eventId: () => string;

  constructor(
    private readonly pool: TransactionPool,
    options: { eventId?: () => string } = {},
  ) {
    this.eventId =
      options.eventId ??
      (() => {
        throw new Error("A production World event identity generator is required");
      });
  }

  async prepare(runIdInput: unknown) {
    const runId = RunIdSchema.parse(runIdInput);
    const client = await this.pool.connect();
    try {
      const result = await client.query<DispatchRow>(SELECT_RUN, [runId]);
      if (result.rows.length === 0) throw new RunDispatchStoreError("RUN_NOT_FOUND");
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new Error("Run dispatch cardinality is invalid");
      }
      const row = result.rows[0];
      const run = parseRun(row);
      if (run.status !== "DISPATCH_PENDING") {
        return { kind: "ALREADY_DISPATCHED" as const, run };
      }
      if (
        row.binding_is_enabled !== true ||
        row.session_ended_at !== null ||
        row.title === undefined ||
        row.external_agent_id === undefined ||
        row.external_session_ref === undefined
      ) {
        throw new RunDispatchStoreError("ROUTE_UNAVAILABLE");
      }
      return {
        kind: "READY" as const,
        run,
        task: {
          id: TaskIdSchema.parse(row.task_id),
          agentId: AgentIdSchema.parse(row.agent_id),
          title: z.string().trim().min(1).max(200).parse(row.title),
          ...(row.description === null
            ? {}
            : { description: z.string().trim().min(1).max(20_000).parse(row.description) }),
        },
        binding: {
          id: BindingIdSchema.parse(row.binding_id),
          adapterKind: ExecutionAdapterKindSchema.parse(row.adapter_kind),
          externalAgentId: OpaqueExternalIdSchema.parse(row.external_agent_id),
        },
        session: {
          id: SessionIdSchema.parse(row.session_id),
          externalSessionRef: OpaqueExternalIdSchema.parse(row.external_session_ref),
        },
      };
    } finally {
      client.release();
    }
  }

  async markRunning(input: z.input<typeof MarkRunningSchema>) {
    const receipt = MarkRunningSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        "agent_world:world_projection",
      ]);
      const result = await client.query<DispatchRow>(`${SELECT_RUN} FOR UPDATE OF r`, [
        receipt.runId,
      ]);
      if (result.rows.length === 0) throw new RunDispatchStoreError("RUN_NOT_FOUND");
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new Error("Run dispatch cardinality is invalid");
      }
      const row = result.rows[0];
      const current = parseRun(row);
      if (current.status === "RUNNING") {
        if (current.externalRunId !== receipt.externalRunId) {
          throw new RunDispatchStoreError("RECEIPT_CONFLICT");
        }
        await client.query("COMMIT");
        return { outcome: "REPLAY" as const, run: current };
      }
      if (current.status !== "DISPATCH_PENDING") {
        throw new RunDispatchStoreError("RUN_NOT_PENDING");
      }
      if (Date.parse(receipt.startedAt) < Date.parse(current.createdAt)) {
        throw new RunDispatchStoreError("RECEIPT_CONFLICT");
      }
      const running = RunSchema.parse({
        ...current,
        status: "RUNNING",
        attempt: 1,
        externalRunId: receipt.externalRunId,
        startedAt: receipt.startedAt,
      });
      await client.query(
        `UPDATE agent_world.runs
            SET status = 'RUNNING', attempt = 1, external_run_id = $2, started_at = $3
          WHERE id = $1`,
        [running.id, running.externalRunId, running.startedAt],
      );
      const sequence = await client.query<SequenceRow>(
        `UPDATE agent_world.world_event_stream
            SET last_sequence = last_sequence + 1
          WHERE singleton = true
        RETURNING last_sequence`,
      );
      if (sequence.rows.length !== 1 || !sequence.rows[0]) {
        throw new Error("World event stream counter is unavailable");
      }
      const eventId = EventIdSchema.parse(this.eventId());
      await client.query(
        `INSERT INTO agent_world.world_events
           (sequence, id, occurred_at, source_kind, source_actor, command_id,
            event_type, agent_id, status, task_id, run_id)
         VALUES ($1, $2, $3, 'DOMAIN', 'SYSTEM_POLICY', $4,
                 'AGENT_STATUS_CHANGED', $5, 'RUNNING', $6, $7)`,
        [
          safeSequence(sequence.rows[0].last_sequence),
          eventId,
          running.startedAt,
          running.dispatchIdempotencyKey,
          running.agentId,
          running.taskId,
          running.id,
        ],
      );
      await client.query(
        `INSERT INTO agent_world.world_agent_status
           (agent_id, status, last_event_id, updated_at)
         VALUES ($1, 'RUNNING', $2, $3)
         ON CONFLICT (agent_id) DO UPDATE
           SET status = EXCLUDED.status,
               last_event_id = EXCLUDED.last_event_id,
               updated_at = EXCLUDED.updated_at`,
        [running.agentId, eventId, running.startedAt],
      );
      await client.query("COMMIT");
      return { outcome: "UPDATED" as const, run: running };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the Run transition failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
