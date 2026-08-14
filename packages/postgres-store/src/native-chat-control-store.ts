import { createHash } from "node:crypto";
import {
  type AccountId,
  AccountIdSchema,
  applyNativeChatControlEvent,
  ContextItemIdSchema,
  EventIdSchema,
  MemoryProposalIdSchema,
  type NativeChatControlEventInput,
  NativeChatControlEventInputSchema,
  type NativeChatRunControlState,
  NativeChatRunControlStateSchema,
  ProjectIdSchema,
  StructuredAgentOutputSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import * as z from "zod";
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
  project_id: string;
  state: string;
  last_sequence: number;
  created_at: Date | string;
  submitted_at: Date | string | null;
  attached_at: Date | string | null;
  failed_at: Date | string | null;
  failure_code: string | null;
  begin_deadline_at: Date | string;
  completion_deadline_at: Date | string | null;
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
  | "CAPABILITY_EXPIRED"
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

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
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
       d.attached_at, d.failed_at, d.failure_code, d.begin_deadline_at,
       d.completion_deadline_at, r.status AS run_status,
       r.adapter_kind, r.created_at AS run_created_at, t.project_id
  FROM agent_world.native_chat_dispatches d
  JOIN agent_world.runs r ON r.id = d.run_id
  JOIN agent_world.tasks t ON t.id = d.task_id
 WHERE d.run_id = $1
 FOR UPDATE OF d, r, t`;

export class PostgresNativeChatControlStore {
  private readonly eventId: () => string;
  private readonly now: () => Date;
  private readonly hashEvent: (event: NativeChatControlEventInput) => string;
  private readonly contextItemId: () => string;
  private readonly memoryProposalId: () => string;
  private readonly memoryEventId: () => string;

  constructor(
    private readonly pool: TransactionPool,
    options: {
      eventId?: () => string;
      now?: () => Date;
      hashEvent?: (event: NativeChatControlEventInput) => string;
      contextItemId?: () => string;
      memoryProposalId?: () => string;
      memoryEventId?: () => string;
    } = {},
  ) {
    this.eventId =
      options.eventId ??
      (() => {
        throw new Error("A production World event identity generator is required");
      });
    this.now = options.now ?? (() => new Date());
    this.hashEvent = options.hashEvent ?? hashJson;
    this.contextItemId =
      options.contextItemId ??
      (() => {
        throw new Error("A production ContextItem identity generator is required");
      });
    this.memoryProposalId =
      options.memoryProposalId ??
      (() => {
        throw new Error("A production MemoryProposal identity generator is required");
      });
    this.memoryEventId = options.memoryEventId ?? this.eventId;
  }

  async append(accountIdInput: unknown, eventInput: unknown) {
    return this.appendEvent(accountIdInput, eventInput, false);
  }

  private async appendEvent(accountIdInput: unknown, eventInput: unknown, allowExpired: boolean) {
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
      this.assertAuthorizedState(accountId, event, row, occurredAt, allowExpired);
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
              SET state = 'ATTACHED', attached_at = $2, last_sequence = $3,
                  completion_deadline_at = $4
            WHERE run_id = $1`,
          [
            event.runId,
            occurredAt,
            event.sequence,
            new Date(Date.parse(occurredAt) + 4 * 60 * 60_000).toISOString(),
          ],
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
        await this.materializeCommittedResult(client, row, event, occurredAt);
        await this.appendWorldStatus(client, row, "IDLE", event.idempotencyKey, occurredAt);
      } else if (event.eventType === "FAIL") {
        await client.query(
          `UPDATE agent_world.native_chat_dispatches
              SET state = 'FAILED', last_sequence = $2, failed_at = $3, failure_code = $4,
                  lease_owner = NULL, lease_expires_at = NULL
            WHERE run_id = $1`,
          [event.runId, event.sequence, occurredAt, event.payload.failureCode],
        );
        await client.query(
          `UPDATE agent_world.runs
              SET status = 'FAILED', attempt = GREATEST(attempt, 1),
                  completed_at = $2, failure_code = $3
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

  async reconcileExpired(limitInput = 50) {
    const limit = z.number().int().min(1).max(500).parse(limitInput);
    const reconciledAt = TimestampSchema.parse(this.now().toISOString());
    const client = await this.pool.connect();
    let rows: Array<Pick<ControlRow, "run_id" | "account_id" | "state" | "last_sequence">>;
    try {
      const result = await client.query<ControlRow>(
        `SELECT d.run_id, d.account_id, d.state, d.last_sequence
           FROM agent_world.native_chat_dispatches d
           JOIN agent_world.runs r ON r.id = d.run_id
          WHERE r.status IN ('DISPATCH_PENDING', 'RUNNING')
            AND (
              (d.state IN ('QUEUED', 'BROWSER_SUBMITTED', 'FAILED')
                AND (d.state = 'FAILED' OR d.begin_deadline_at <= $1))
              OR
              (d.state = 'ATTACHED' AND d.completion_deadline_at <= $1)
            )
          ORDER BY COALESCE(d.completion_deadline_at, d.begin_deadline_at), d.id
          LIMIT $2`,
        [reconciledAt, limit],
      );
      rows = result.rows;
    } finally {
      client.release();
    }

    let reconciled = 0;
    let raced = 0;
    for (const row of rows) {
      const waitingForCommit = row.state === "ATTACHED";
      const failureCode = waitingForCommit
        ? "NATIVE_CHAT_COMMIT_TIMEOUT"
        : row.state === "FAILED"
          ? "NATIVE_CHAT_LAUNCH_FAILED"
          : "NATIVE_CHAT_BEGIN_TIMEOUT";
      try {
        await this.appendEvent(
          row.account_id,
          {
            schemaVersion: 1,
            runId: row.run_id,
            sequence: row.last_sequence + 1,
            idempotencyKey: `native-chat:reconcile:${row.run_id.slice("run_".length)}`,
            eventType: "FAIL",
            payload: {
              failureCode,
              message: waitingForCommit
                ? "Native Chat did not commit a result before its canonical deadline."
                : "Native Chat did not attach before its canonical deadline.",
              retryable: true,
            },
          },
          true,
        );
        reconciled += 1;
      } catch (error) {
        if (isNativeChatControlStoreError(error)) raced += 1;
        else throw error;
      }
    }
    return { candidates: rows.length, reconciled, raced, reconciledAt };
  }

  private async materializeCommittedResult(
    client: Awaited<ReturnType<TransactionPool["connect"]>>,
    row: ControlRow,
    event: Extract<NativeChatControlEventInput, { eventType: "COMMIT_RESULT" }>,
    occurredAt: string,
  ) {
    const result = StructuredAgentOutputSchema.parse(event.payload.result);
    const projectId = ProjectIdSchema.parse(row.project_id);
    const contextItemId = ContextItemIdSchema.parse(this.contextItemId());
    const contentHash = createHash("sha256").update(result.summary, "utf8").digest("hex");
    const estimatedTokens = Math.max(1, Math.min(100_000, Math.ceil(result.summary.length / 4)));
    await client.query(
      `INSERT INTO agent_world.context_items
         (id, project_id, kind, temperature, content, summary, content_sha256,
          estimated_tokens, importance, provenance_kind, run_id, agent_id, task_id, created_at)
       VALUES ($1, $2, 'AGENT_RESULT', 'HOT', $3, $3, $4, $5, $6,
               'RUN', $7, $8, $9, $10)`,
      [
        contextItemId,
        projectId,
        result.summary,
        contentHash,
        estimatedTokens,
        result.confidence,
        event.runId,
        row.agent_id,
        row.task_id,
        occurredAt,
      ],
    );

    for (const candidate of result.memoryCandidates) {
      const proposalId = MemoryProposalIdSchema.parse(this.memoryProposalId());
      const candidateHash = createHash("sha256").update(candidate.statement, "utf8").digest("hex");
      const candidateTokens = Math.max(
        1,
        Math.min(10_000, Math.ceil(candidate.statement.length / 4)),
      );
      const proposal = {
        schemaVersion: 1,
        id: proposalId,
        projectId,
        sourceContextItemId: contextItemId,
        content: candidate.statement,
        contentHash: candidateHash,
        estimatedTokens: candidateTokens,
        importance: candidate.importance,
        status: "PENDING",
        createdAt: occurredAt,
      } as const;
      const { id: _proposalId, ...canonicalProposal } = proposal;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO agent_world.memory_proposals
           (id, project_id, source_context_item_id, content, content_sha256,
            estimated_tokens, importance, status, request_sha256, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9)
         ON CONFLICT (project_id, source_context_item_id, content_sha256) DO NOTHING
         RETURNING id`,
        [
          proposalId,
          projectId,
          contextItemId,
          candidate.statement,
          candidateHash,
          candidateTokens,
          candidate.importance,
          hashJson(canonicalProposal),
          occurredAt,
        ],
      );
      if (!inserted.rows[0]) continue;
      const memoryEventId = EventIdSchema.parse(this.memoryEventId());
      await client.query(
        `INSERT INTO agent_world.memory_events
           (id, event_type, project_id, proposal_id, source_context_item_id,
            content, payload_sha256, occurred_at)
         VALUES ($1, 'MEMORY_PROPOSED', $2, $3, $4, $5, $6, $7)`,
        [
          memoryEventId,
          projectId,
          proposalId,
          contextItemId,
          candidate.statement,
          hashJson({ eventType: "MEMORY_PROPOSED", proposal }),
          occurredAt,
        ],
      );
    }
  }

  private assertAuthorizedState(
    accountId: AccountId,
    event: NativeChatControlEventInput,
    row: ControlRow,
    occurredAt: string,
    allowExpired: boolean,
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
    if (
      !allowExpired &&
      ((event.eventType === "BEGIN_RUN" &&
        Date.parse(occurredAt) >= Date.parse(String(row.begin_deadline_at))) ||
        (row.run_status === "RUNNING" &&
          row.completion_deadline_at !== null &&
          Date.parse(occurredAt) >= Date.parse(String(row.completion_deadline_at))))
    ) {
      throw new NativeChatControlStoreError("CAPABILITY_EXPIRED");
    }
    if (
      event.eventType !== "BEGIN_RUN" &&
      !(event.eventType === "FAIL" && row.run_status === "DISPATCH_PENDING") &&
      row.run_status !== "RUNNING"
    ) {
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
