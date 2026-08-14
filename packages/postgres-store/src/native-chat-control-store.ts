import { createHash } from "node:crypto";
import {
  type AccountId,
  AccountIdSchema,
  applyNativeChatControlEvent,
  EventIdSchema,
  type NativeChatControlEventInput,
  NativeChatControlEventInputSchema,
  type NativeChatRunControlState,
  NativeChatRunControlStateSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

type ExistingEventRow = QueryResultRow & {
  account_id: string;
  run_id: string;
  sequence: number;
  event_type: string;
  payload: unknown;
  event_sha256: string;
};

type ControlRow = QueryResultRow & {
  id: string;
  run_id: string;
  task_id: string;
  agent_id: string;
  account_id: string;
  route_id: string;
  state: string;
  last_sequence: number;
  created_at: Date | string;
  submitted_at: Date | string | null;
  attached_at: Date | string | null;
  failed_at: Date | string | null;
  failure_code: string | null;
  run_status: string;
  adapter_kind: string;
  run_created_at: Date | string;
};

type SequenceRow = QueryResultRow & { last_sequence: string | number };

export type NativeChatControlStoreErrorCode =
  | "RUN_NOT_FOUND"
  | "ACCOUNT_MISMATCH"
  | "ADAPTER_MISMATCH"
  | "DISPATCH_NOT_SUBMITTED"
  | "BEGIN_REQUIRED"
  | "BEGIN_REPEATED"
  | "SEQUENCE_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "RUN_TERMINAL"
  | "RUN_STATE_CONFLICT";

export class NativeChatControlStoreError extends Error {
  constructor(readonly code: NativeChatControlStoreErrorCode) {
    super(code);
    this.name = "NativeChatControlStoreError";
  }
}

function safeSequence(input: string | number): number {
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("World event sequence exceeds the safe read-model range");
  }
  return value;
}

function defaultHash(event: NativeChatControlEventInput): string {
  return createHash("sha256").update(JSON.stringify(event), "utf8").digest("hex");
}

function stateFromRow(row: ControlRow): NativeChatRunControlState {
  const status =
    row.run_status === "COMPLETED"
      ? "COMPLETED"
      : row.run_status === "FAILED"
        ? "FAILED"
        : row.last_sequence === 0
          ? "AWAITING_BEGIN"
          : "RUNNING";
  return NativeChatRunControlStateSchema.parse({
    runId: row.run_id,
    status,
    lastSequence: row.last_sequence,
  });
}

const SELECT_CONTROL = `SELECT d.id, d.run_id, d.task_id, d.agent_id, d.account_id,
       d.route_id, d.state, d.last_sequence, d.created_at, d.submitted_at,
       d.attached_at, d.failed_at, d.failure_code, r.status AS run_status,
       r.adapter_kind, r.created_at AS run_created_at
  FROM agent_world.native_chat_dispatches d
  JOIN agent_world.runs r ON r.id = d.run_id
 WHERE d.run_id = $1
 FOR UPDATE OF d, r`;

export class PostgresNativeChatControlStore {
  private readonly eventId: () => string;
  private readonly now: () => Date;
  private readonly hashEvent: (event: NativeChatControlEventInput) => string;

  constructor(
    private readonly pool: TransactionPool,
    options: {
      eventId?: () => string;
      now?: () => Date;
      hashEvent?: (event: NativeChatControlEventInput) => string;
    } = {},
  ) {
    this.eventId =
      options.eventId ??
      (() => {
        throw new Error("A production World event identity generator is required");
      });
    this.now = options.now ?? (() => new Date());
    this.hashEvent = options.hashEvent ?? defaultHash;
  }

  async append(accountIdInput: unknown, eventInput: unknown) {
    const accountId = AccountIdSchema.parse(accountIdInput);
    const event = NativeChatControlEventInputSchema.parse(eventInput);
    const eventHash = this.hashEvent(event);
    const occurredAt = TimestampSchema.parse(this.now().toISOString());
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `agent_world:native_chat_control:${event.runId}`,
      ]);
      const existing = await client.query<ExistingEventRow>(
        `SELECT account_id, run_id, sequence, event_type, payload, event_sha256
           FROM agent_world.native_chat_control_events
          WHERE idempotency_key = $1`,
        [event.idempotencyKey],
      );
      if (existing.rows.length > 1) throw new Error("Control idempotency cardinality is invalid");
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.account_id !== accountId) {
          throw new NativeChatControlStoreError("ACCOUNT_MISMATCH");
        }
        if (row.run_id !== event.runId || row.event_sha256 !== eventHash) {
          throw new NativeChatControlStoreError("IDEMPOTENCY_CONFLICT");
        }
        await client.query("COMMIT");
        return {
          outcome: "REPLAY" as const,
          event: { runId: event.runId, sequence: row.sequence, eventType: row.event_type },
        };
      }

      const selected = await client.query<ControlRow>(SELECT_CONTROL, [event.runId]);
      if (selected.rows.length === 0) throw new NativeChatControlStoreError("RUN_NOT_FOUND");
      if (selected.rows.length !== 1 || !selected.rows[0]) {
        throw new Error("Native Chat control cardinality is invalid");
      }
      const row = selected.rows[0];
      this.assertAuthorizedState(accountId, event, row);
      const current = stateFromRow(row);
      let next: NativeChatRunControlState;
      try {
        next = applyNativeChatControlEvent(current, event);
      } catch (cause) {
        throw this.mapTransitionError(cause);
      }

      await client.query(
        `INSERT INTO agent_world.native_chat_control_events
           (run_id, account_id, sequence, idempotency_key, event_type, payload,
            event_sha256, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [
          event.runId,
          accountId,
          event.sequence,
          event.idempotencyKey,
          event.eventType,
          JSON.stringify(event.payload),
          eventHash,
          occurredAt,
        ],
      );

      if (event.eventType === "BEGIN_RUN") {
        await client.query(
          `UPDATE agent_world.native_chat_dispatches
              SET state = 'ATTACHED', attached_at = $2, last_sequence = $3
            WHERE run_id = $1`,
          [event.runId, occurredAt, event.sequence],
        );
        await client.query(
          `UPDATE agent_world.runs
              SET status = 'RUNNING', attempt = 1, external_run_id = $2, started_at = $3
            WHERE id = $1`,
          [event.runId, `native-chat:${row.id}`, occurredAt],
        );
        await this.appendWorldStatus(client, row, "RUNNING", event.idempotencyKey, occurredAt);
      } else if (event.eventType === "COMMIT_RESULT") {
        const resultJson = JSON.stringify(event.payload.result);
        const resultHash = createHash("sha256").update(resultJson, "utf8").digest("hex");
        await client.query(
          `INSERT INTO agent_world.native_chat_results
             (run_id, account_id, event_sequence, structured_result, result_sha256, committed_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
          [event.runId, accountId, event.sequence, resultJson, resultHash, occurredAt],
        );
        await client.query(
          `UPDATE agent_world.native_chat_dispatches SET last_sequence = $2 WHERE run_id = $1`,
          [event.runId, event.sequence],
        );
        await client.query(
          `UPDATE agent_world.runs SET status = 'COMPLETED', completed_at = $2 WHERE id = $1`,
          [event.runId, occurredAt],
        );
        await this.appendWorldStatus(client, row, "IDLE", event.idempotencyKey, occurredAt);
      } else if (event.eventType === "FAIL") {
        await client.query(
          `UPDATE agent_world.native_chat_dispatches SET last_sequence = $2 WHERE run_id = $1`,
          [event.runId, event.sequence],
        );
        await client.query(
          `UPDATE agent_world.runs
              SET status = 'FAILED', completed_at = $2, failure_code = $3
            WHERE id = $1`,
          [event.runId, occurredAt, event.payload.failureCode],
        );
        await this.appendWorldStatus(client, row, "FAILED", event.idempotencyKey, occurredAt);
      } else {
        await client.query(
          `UPDATE agent_world.native_chat_dispatches SET last_sequence = $2 WHERE run_id = $1`,
          [event.runId, event.sequence],
        );
      }

      await client.query("COMMIT");
      return { outcome: "APPENDED" as const, state: next, occurredAt };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the canonical transition failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private assertAuthorizedState(
    accountId: AccountId,
    event: NativeChatControlEventInput,
    row: ControlRow,
  ) {
    if (row.account_id !== accountId) throw new NativeChatControlStoreError("ACCOUNT_MISMATCH");
    if (row.adapter_kind !== "NATIVE_CHATGPT") {
      throw new NativeChatControlStoreError("ADAPTER_MISMATCH");
    }
    if (
      row.run_status === "COMPLETED" ||
      row.run_status === "FAILED" ||
      row.run_status === "CANCELLED"
    ) {
      throw new NativeChatControlStoreError("RUN_TERMINAL");
    }
    if (event.eventType === "BEGIN_RUN" && row.state !== "BROWSER_SUBMITTED") {
      throw new NativeChatControlStoreError("DISPATCH_NOT_SUBMITTED");
    }
    if (event.eventType !== "BEGIN_RUN" && row.run_status !== "RUNNING") {
      throw new NativeChatControlStoreError("BEGIN_REQUIRED");
    }
  }

  private mapTransitionError(cause: unknown): NativeChatControlStoreError {
    const message = cause instanceof Error ? cause.message : "";
    if (/sequence/i.test(message)) return new NativeChatControlStoreError("SEQUENCE_CONFLICT");
    if (/before other|begin_run is required/i.test(message)) {
      return new NativeChatControlStoreError("BEGIN_REQUIRED");
    }
    if (/repeated/i.test(message)) return new NativeChatControlStoreError("BEGIN_REPEATED");
    if (/terminal/i.test(message)) return new NativeChatControlStoreError("RUN_TERMINAL");
    return new NativeChatControlStoreError("RUN_STATE_CONFLICT");
  }

  private async appendWorldStatus(
    client: Awaited<ReturnType<TransactionPool["connect"]>>,
    row: ControlRow,
    status: "RUNNING" | "IDLE" | "FAILED",
    commandId: string,
    occurredAt: string,
  ) {
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
               'AGENT_STATUS_CHANGED', $5, $6, $7, $8)`,
      [
        safeSequence(sequence.rows[0].last_sequence),
        eventId,
        occurredAt,
        commandId,
        row.agent_id,
        status,
        row.task_id,
        row.run_id,
      ],
    );
    await client.query(
      `INSERT INTO agent_world.world_agent_status (agent_id, status, last_event_id, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (agent_id) DO UPDATE
         SET status = EXCLUDED.status,
             last_event_id = EXCLUDED.last_event_id,
             updated_at = EXCLUDED.updated_at`,
      [row.agent_id, status, eventId, occurredAt],
    );
  }
}

export function isNativeChatControlStoreError(
  error: unknown,
): error is NativeChatControlStoreError {
  return error instanceof NativeChatControlStoreError;
}
