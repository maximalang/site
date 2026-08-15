import {
  AgentIdSchema,
  ApprovalIdSchema,
  type ApprovalState,
  ApprovalStateSchema,
  BindingIdSchema,
  BrokerDecisionIdSchema,
  ChatDispatchIdSchema,
  CommandIdSchema,
  EventIdSchema,
  ExecutionModeSchema,
  type Run,
  RunIdSchema,
  RunSchema,
  SessionIdSchema,
  TaskIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { ResourceBrokerDecision } from "@agent-world/read-model";
import type { QueryResultRow } from "pg";
import * as z from "zod";
import type { TransactionClient, TransactionPool } from "./conversation-store.js";
import {
  decideResourceRouteInTransaction,
  type ResourceBrokerDecisionInput,
} from "./resource-broker-store.js";

const DecisionSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    taskId: TaskIdSchema,
    approvalId: ApprovalIdSchema,
    decision: z.literal("APPROVE"),
    commandId: CommandIdSchema,
    decidedAt: TimestampSchema,
  }),
  z.strictObject({
    taskId: TaskIdSchema,
    approvalId: ApprovalIdSchema,
    decision: z.literal("DENY"),
    reason: z.string().trim().min(1).max(1_000),
    commandId: CommandIdSchema,
    decidedAt: TimestampSchema,
  }),
  z.strictObject({
    taskId: TaskIdSchema,
    approvalId: ApprovalIdSchema,
    decision: z.literal("REVOKE"),
    reason: z.string().trim().min(1).max(1_000),
    commandId: CommandIdSchema,
    decidedAt: TimestampSchema,
  }),
]);

type ApprovalTaskRow = QueryResultRow & {
  id: string;
  task_id: string;
  state: string;
  requested_at: Date | string;
  expires_at: Date | string;
  decided_at: Date | string | null;
  reason: string | null;
  decision_command_id: string | null;
  conversation_id: string;
  project_id: string;
  agent_id: string;
  dependencies_ready: boolean;
};

type ActiveSessionRow = QueryResultRow & {
  session_id: string;
  binding_id: string;
  adapter_kind: string;
  route_id: string;
};

type RunRow = QueryResultRow & {
  id: string;
  task_id: string;
  agent_id: string;
  approval_id: string;
  adapter_kind: string;
  binding_id: string | null;
  session_id: string | null;
  route_id: string | null;
  account_id: string | null;
  execution_mode: string | null;
  status: string;
  attempt: number;
  dispatch_idempotency_key: string;
  external_run_id: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  failure_code: string | null;
};

type SequenceRow = QueryResultRow & { last_sequence: string | number };
type BrokerPreferenceRow = QueryResultRow & {
  mode: string;
  account_selection: string;
  account_id: string | null;
  budget_policy: string;
};
type RequiredApprovalState = Exclude<ApprovalState, { type: "NOT_REQUIRED" }>;

export type ApprovalDecisionInput = z.input<typeof DecisionSchema>;
export type ApprovalRunStoreErrorCode =
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_EXPIRED"
  | "DECISION_CONFLICT"
  | "NO_ELIGIBLE_ROUTE"
  | "NO_ACTIVE_SESSION"
  | "RUN_ACTIVE"
  | "DEPENDENCIES_INCOMPLETE";

const ERROR_CODES = new Set<ApprovalRunStoreErrorCode>([
  "APPROVAL_NOT_FOUND",
  "APPROVAL_EXPIRED",
  "DECISION_CONFLICT",
  "NO_ELIGIBLE_ROUTE",
  "NO_ACTIVE_SESSION",
  "RUN_ACTIVE",
  "DEPENDENCIES_INCOMPLETE",
]);

export class ApprovalRunStoreError extends Error {
  constructor(readonly code: ApprovalRunStoreErrorCode) {
    super(code);
    this.name = "ApprovalRunStoreError";
  }
}

export function isApprovalRunStoreError(
  input: unknown,
): input is { name: "ApprovalRunStoreError"; code: ApprovalRunStoreErrorCode } {
  if (typeof input !== "object" || input === null) return false;
  const candidate = input as { name?: unknown; code?: unknown };
  return (
    candidate.name === "ApprovalRunStoreError" &&
    typeof candidate.code === "string" &&
    ERROR_CODES.has(candidate.code as ApprovalRunStoreErrorCode)
  );
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function safeSequence(input: string | number): number {
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("World event sequence exceeds the safe read-model range");
  }
  return value;
}

function parseApproval(row: ApprovalTaskRow): ApprovalState {
  if (row.state === "PENDING") {
    return ApprovalStateSchema.parse({
      type: "PENDING",
      approvalId: row.id,
      requestedAt: iso(row.requested_at),
      expiresAt: iso(row.expires_at),
    });
  }
  if (row.state === "APPROVED") {
    return ApprovalStateSchema.parse({
      type: "APPROVED",
      approvalId: row.id,
      decidedAt: iso(row.decided_at as Date | string),
    });
  }
  if (row.state === "DENIED" || row.state === "REVOKED") {
    return ApprovalStateSchema.parse({
      type: row.state,
      approvalId: row.id,
      decidedAt: iso(row.decided_at as Date | string),
      reason: row.reason,
    });
  }
  throw new Error("Approval row has an unsupported state");
}

function parseRun(row: RunRow): Run {
  const common = {
    schemaVersion: 1,
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id,
    approvalId: row.approval_id,
    adapterKind: row.adapter_kind,
    status: row.status,
    attempt: row.attempt,
    dispatchIdempotencyKey: row.dispatch_idempotency_key,
    ...(row.external_run_id === null ? {} : { externalRunId: row.external_run_id }),
    createdAt: iso(row.created_at),
    ...(row.started_at === null ? {} : { startedAt: iso(row.started_at) }),
    ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }),
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
  };
  return RunSchema.parse(
    row.adapter_kind === "NATIVE_CHATGPT"
      ? {
          ...common,
          routeId: row.route_id,
          accountId: row.account_id,
          executionMode: row.execution_mode,
        }
      : { ...common, bindingId: row.binding_id, sessionId: row.session_id },
  );
}

async function nextSequence(client: TransactionClient): Promise<number> {
  const result = await client.query<SequenceRow>(
    `UPDATE agent_world.world_event_stream
        SET last_sequence = last_sequence + 1
      WHERE singleton = true
    RETURNING last_sequence`,
  );
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new Error("World event stream counter is unavailable");
  }
  return safeSequence(result.rows[0].last_sequence);
}

export class PostgresApprovalRunStore {
  private readonly eventId: () => string;
  private readonly selectRoute: (
    client: TransactionClient,
    input: {
      taskId: string;
      projectId: string;
      agentId: string;
      decidedAt: string;
    },
  ) => Promise<ResourceBrokerDecision>;

  constructor(
    private readonly pool: TransactionPool,
    options: {
      eventId?: () => string;
      selectRoute?: PostgresApprovalRunStore["selectRoute"];
    } = {},
  ) {
    this.eventId =
      options.eventId ??
      (() => {
        throw new Error("A production World event identity generator is required");
      });
    this.selectRoute =
      options.selectRoute ?? ((client, value) => this.selectBrokerRoute(client, value));
  }

  async decide(input: ApprovalDecisionInput) {
    const decision = DecisionSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        "agent_world:world_projection",
      ]);
      const found = await client.query<ApprovalTaskRow>(
        `SELECT a.id, a.task_id, a.state, a.requested_at, a.expires_at,
                a.decided_at, a.reason, a.decision_command_id,
                t.conversation_id, t.project_id, t.assignee_agent_id AS agent_id,
                NOT EXISTS (
                  SELECT 1
                    FROM agent_world.mission_task_dependencies dependency
                   WHERE dependency.task_id = t.id
                     AND NOT EXISTS (
                       SELECT 1
                         FROM agent_world.runs dependency_run
                        WHERE dependency_run.task_id = dependency.depends_on_task_id
                          AND dependency_run.status = 'COMPLETED'
                     )
                ) AS dependencies_ready
           FROM agent_world.approvals a
           JOIN agent_world.tasks t ON t.id = a.task_id
          WHERE a.task_id = $1 OR a.decision_command_id = $2
          FOR UPDATE OF a, t`,
        [decision.taskId, decision.commandId],
      );
      if (found.rows.length === 0) throw new ApprovalRunStoreError("APPROVAL_NOT_FOUND");
      if (found.rows.length !== 1 || !found.rows[0]) {
        throw new ApprovalRunStoreError("DECISION_CONFLICT");
      }
      const row = found.rows[0];
      if (row.task_id !== decision.taskId || row.id !== decision.approvalId) {
        throw new ApprovalRunStoreError("DECISION_CONFLICT");
      }

      if (row.decision_command_id === decision.commandId) {
        const existingRun = await client.query<RunRow>(
          `SELECT id, task_id, agent_id, approval_id, adapter_kind, binding_id,
                  session_id, route_id, account_id, execution_mode,
                  status, attempt, dispatch_idempotency_key, external_run_id,
                  created_at, started_at, completed_at, failure_code
             FROM agent_world.runs
            WHERE task_id = $1
            FOR SHARE`,
          [decision.taskId],
        );
        if (existingRun.rows.length > 1) throw new Error("Run cardinality is invalid");
        const expectedState =
          decision.decision === "APPROVE"
            ? "APPROVED"
            : decision.decision === "DENY"
              ? "DENIED"
              : "REVOKED";
        if (row.state !== expectedState) throw new ApprovalRunStoreError("DECISION_CONFLICT");
        await client.query("COMMIT");
        return {
          outcome: "REPLAY" as const,
          approval: parseApproval(row),
          ...(existingRun.rows[0] ? { run: parseRun(existingRun.rows[0]) } : {}),
        };
      }

      if (Date.parse(decision.decidedAt) < Date.parse(iso(row.requested_at))) {
        throw new ApprovalRunStoreError("DECISION_CONFLICT");
      }
      if (
        row.state === "PENDING" &&
        Date.parse(decision.decidedAt) >= Date.parse(iso(row.expires_at))
      ) {
        throw new ApprovalRunStoreError("APPROVAL_EXPIRED");
      }

      if (decision.decision === "APPROVE") {
        if (row.state !== "PENDING") throw new ApprovalRunStoreError("DECISION_CONFLICT");
        if (!row.dependencies_ready) {
          throw new ApprovalRunStoreError("DEPENDENCIES_INCOMPLETE");
        }
        const brokerDecision = await this.selectRoute(client, {
          taskId: row.task_id,
          projectId: row.project_id,
          agentId: row.agent_id,
          decidedAt: decision.decidedAt,
        });
        const selected = brokerDecision.selected;
        if (!selected) throw new ApprovalRunStoreError("NO_ELIGIBLE_ROUTE");
        const canonicalRunId = RunIdSchema.parse(`run_${decision.taskId.slice("task_".length)}`);
        const commonRun = {
          schemaVersion: 1 as const,
          id: canonicalRunId,
          taskId: decision.taskId,
          agentId: AgentIdSchema.parse(row.agent_id),
          approvalId: decision.approvalId,
          status: "DISPATCH_PENDING" as const,
          attempt: 0,
          dispatchIdempotencyKey: `run:${decision.taskId.slice("task_".length)}`,
          createdAt: decision.decidedAt,
        };
        let session: ActiveSessionRow | undefined;
        if (selected.adapterKind !== "NATIVE_CHATGPT") {
          const active = await client.query<ActiveSessionRow>(
            `SELECT s.id AS session_id, s.binding_id, s.adapter_kind, b.route_id
               FROM agent_world.conversation_sessions s
               JOIN agent_world.runtime_bindings b
                 ON b.id = s.binding_id
                AND b.agent_id = s.agent_id
                AND b.adapter_kind = s.adapter_kind
              WHERE s.conversation_id = $1
                AND s.agent_id = $2
                AND s.ended_at IS NULL
                AND s.adapter_kind IN ('OPENCLAW', 'CODEX')
                AND s.adapter_kind = $3
                AND b.route_id = $4
                AND b.is_enabled = true
              FOR SHARE OF s, b`,
            [row.conversation_id, row.agent_id, selected.adapterKind, selected.routeId],
          );
          if (active.rows.length !== 1 || !active.rows[0]) {
            throw new ApprovalRunStoreError("NO_ACTIVE_SESSION");
          }
          session = active.rows[0];
        }
        const run = RunSchema.parse(
          selected.adapterKind === "NATIVE_CHATGPT"
            ? {
                ...commonRun,
                adapterKind: "NATIVE_CHATGPT",
                routeId: selected.routeId,
                accountId: selected.accountId,
                executionMode: selected.mode,
              }
            : {
                ...commonRun,
                adapterKind: selected.adapterKind,
                bindingId: BindingIdSchema.parse(session?.binding_id),
                sessionId: SessionIdSchema.parse(session?.session_id),
              },
        );
        await client.query(
          `UPDATE agent_world.approvals
              SET state = 'APPROVED', decided_at = $2, decision_command_id = $3
            WHERE id = $1`,
          [decision.approvalId, decision.decidedAt, decision.commandId],
        );
        if (run.adapterKind === "NATIVE_CHATGPT") {
          await client.query(
            `INSERT INTO agent_world.runs
               (id, task_id, conversation_id, agent_id, approval_id, adapter_kind,
                route_id, account_id, execution_mode, status, attempt,
                dispatch_idempotency_key, created_at)
             VALUES ($1, $2, $3, $4, $5, 'NATIVE_CHATGPT', $6, $7, 'CHAT',
                     'DISPATCH_PENDING', 0, $8, $9)`,
            [
              run.id,
              run.taskId,
              row.conversation_id,
              run.agentId,
              run.approvalId,
              run.routeId,
              run.accountId,
              run.dispatchIdempotencyKey,
              run.createdAt,
            ],
          );
          await client.query(
            `INSERT INTO agent_world.native_chat_dispatches
               (id, run_id, task_id, agent_id, account_id, route_id, state,
                created_at, begin_deadline_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', $7, $8)`,
            [
              ChatDispatchIdSchema.parse(`chat_dispatch_${decision.taskId.slice("task_".length)}`),
              run.id,
              run.taskId,
              run.agentId,
              run.accountId,
              run.routeId,
              run.createdAt,
              new Date(Date.parse(run.createdAt) + 30 * 60_000).toISOString(),
            ],
          );
        } else {
          await client.query(
            `INSERT INTO agent_world.runs
               (id, task_id, conversation_id, agent_id, approval_id, adapter_kind,
                binding_id, session_id, status, attempt, dispatch_idempotency_key, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DISPATCH_PENDING', 0, $9, $10)`,
            [
              run.id,
              run.taskId,
              row.conversation_id,
              run.agentId,
              run.approvalId,
              run.adapterKind,
              run.bindingId,
              run.sessionId,
              run.dispatchIdempotencyKey,
              run.createdAt,
            ],
          );
        }
        await this.appendApprovalEvent(client, row, decision.commandId, decision.decidedAt, {
          type: "APPROVED",
          approvalId: decision.approvalId,
          decidedAt: decision.decidedAt,
        });
        await this.appendStatusEvent(
          client,
          row,
          decision.commandId,
          decision.decidedAt,
          run,
          "QUEUED",
        );
        await client.query("COMMIT");
        return {
          outcome: "DECIDED" as const,
          approval: ApprovalStateSchema.parse({
            type: "APPROVED",
            approvalId: decision.approvalId,
            decidedAt: decision.decidedAt,
          }),
          run,
        };
      }

      if (decision.decision === "DENY") {
        if (row.state !== "PENDING") throw new ApprovalRunStoreError("DECISION_CONFLICT");
        const approval = ApprovalStateSchema.parse({
          type: "DENIED",
          approvalId: decision.approvalId,
          decidedAt: decision.decidedAt,
          reason: decision.reason,
        }) as RequiredApprovalState;
        await client.query(
          `UPDATE agent_world.approvals
              SET state = 'DENIED', decided_at = $2, reason = $3, decision_command_id = $4
            WHERE id = $1`,
          [decision.approvalId, decision.decidedAt, decision.reason, decision.commandId],
        );
        await this.appendApprovalEvent(
          client,
          row,
          decision.commandId,
          decision.decidedAt,
          approval,
        );
        await client.query("COMMIT");
        return { outcome: "DECIDED" as const, approval, run: undefined };
      }

      if (row.state !== "APPROVED") throw new ApprovalRunStoreError("DECISION_CONFLICT");
      const existingRun = await client.query<RunRow>(
        `SELECT id, task_id, agent_id, approval_id, adapter_kind, binding_id,
                session_id, route_id, account_id, execution_mode,
                status, attempt, dispatch_idempotency_key, external_run_id,
                created_at, started_at, completed_at, failure_code
           FROM agent_world.runs
          WHERE task_id = $1
          FOR UPDATE`,
        [decision.taskId],
      );
      if (existingRun.rows.length !== 1 || !existingRun.rows[0]) {
        throw new ApprovalRunStoreError("DECISION_CONFLICT");
      }
      if (existingRun.rows[0].status !== "DISPATCH_PENDING") {
        throw new ApprovalRunStoreError("RUN_ACTIVE");
      }
      const approval = ApprovalStateSchema.parse({
        type: "REVOKED",
        approvalId: decision.approvalId,
        decidedAt: decision.decidedAt,
        reason: decision.reason,
      }) as RequiredApprovalState;
      await client.query(
        `UPDATE agent_world.approvals
            SET state = 'REVOKED', decided_at = $2, reason = $3, decision_command_id = $4
          WHERE id = $1`,
        [decision.approvalId, decision.decidedAt, decision.reason, decision.commandId],
      );
      await client.query(
        `UPDATE agent_world.runs
            SET status = 'CANCELLED', completed_at = $2
          WHERE id = $1`,
        [existingRun.rows[0].id, decision.decidedAt],
      );
      if (existingRun.rows[0].adapter_kind === "NATIVE_CHATGPT") {
        await client.query(
          `UPDATE agent_world.native_chat_dispatches
              SET state = 'FAILED', failed_at = $2, failure_code = 'APPROVAL_REVOKED'
            WHERE run_id = $1 AND state IN ('QUEUED', 'BROWSER_SUBMITTED')`,
          [existingRun.rows[0].id, decision.decidedAt],
        );
      }
      await this.appendApprovalEvent(client, row, decision.commandId, decision.decidedAt, approval);
      const cancelledRun = parseRun({
        ...existingRun.rows[0],
        status: "CANCELLED",
        completed_at: decision.decidedAt,
      });
      await this.appendStatusEvent(
        client,
        row,
        decision.commandId,
        decision.decidedAt,
        cancelledRun,
        "IDLE",
      );
      await client.query("COMMIT");
      return { outcome: "DECIDED" as const, approval, run: cancelledRun };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the decision failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async selectBrokerRoute(
    client: TransactionClient,
    input: { taskId: string; projectId: string; agentId: string; decidedAt: string },
  ): Promise<ResourceBrokerDecision> {
    const preference = (
      await client.query<BrokerPreferenceRow>(
        `WITH ranked AS (
           SELECT mode, account_selection, account_id, budget_policy,
                  CASE scope_kind
                    WHEN 'SYSTEM' THEN 0 WHEN 'PROJECT' THEN 1
                    WHEN 'AGENT' THEN 2 WHEN 'TASK' THEN 3
                  END AS precedence
             FROM agent_world.execution_preference_overrides
            WHERE scope_kind = 'SYSTEM'
               OR (scope_kind = 'PROJECT' AND project_id = $1)
               OR (scope_kind = 'AGENT' AND agent_id = $2)
               OR (scope_kind = 'TASK' AND task_id = $3)
         )
         SELECT COALESCE(
                  (SELECT mode FROM ranked WHERE mode IS NOT NULL
                    ORDER BY precedence DESC LIMIT 1), 'AUTO') AS mode,
                COALESCE(
                  (SELECT account_selection FROM ranked WHERE account_selection IS NOT NULL
                    ORDER BY precedence DESC LIMIT 1), 'AUTO') AS account_selection,
                (SELECT account_id FROM ranked WHERE account_selection IS NOT NULL
                  ORDER BY precedence DESC LIMIT 1) AS account_id,
                COALESCE(
                  (SELECT budget_policy FROM ranked WHERE budget_policy IS NOT NULL
                    ORDER BY precedence DESC LIMIT 1), 'BALANCED') AS budget_policy`,
        [input.projectId, input.agentId, input.taskId],
      )
    ).rows[0];
    if (!preference) throw new ApprovalRunStoreError("NO_ELIGIBLE_ROUTE");
    const weights: ResourceBrokerDecisionInput["policy"]["weights"] =
      preference.budget_policy === "QUALITY"
        ? { quality: 0.5, remainingLimits: 0.2, cost: 0.05, speed: 0.15, load: 0.1 }
        : preference.budget_policy === "ECONOMY"
          ? { quality: 0.2, remainingLimits: 0.2, cost: 0.4, speed: 0.1, load: 0.1 }
          : { quality: 0.4, remainingLimits: 0.3, cost: 0.1, speed: 0.1, load: 0.1 };
    const allowedMode =
      preference.mode === "AUTO" ? undefined : ExecutionModeSchema.parse(preference.mode);
    return decideResourceRouteInTransaction(client, {
      decisionId: BrokerDecisionIdSchema.parse(
        `broker_decision_${input.taskId.slice("task_".length)}`,
      ),
      taskId: TaskIdSchema.parse(input.taskId),
      policy: { version: "resource-broker-v1", weights },
      decidedAt: TimestampSchema.parse(input.decidedAt),
      ...(allowedMode === undefined ? {} : { allowedModes: [allowedMode] }),
      allowedAdapterKinds: ["OPENCLAW", "CODEX", "NATIVE_CHATGPT"],
      ...(preference.account_selection === "ACCOUNT" && preference.account_id
        ? { allowedAccountId: preference.account_id }
        : {}),
    });
  }

  private async appendApprovalEvent(
    client: TransactionClient,
    row: ApprovalTaskRow,
    commandId: string,
    occurredAt: string,
    state: RequiredApprovalState,
  ): Promise<void> {
    const eventId = EventIdSchema.parse(this.eventId());
    const sequence = await nextSequence(client);
    await client.query(
      `INSERT INTO agent_world.world_events
         (sequence, id, occurred_at, source_kind, source_actor, command_id,
          event_type, agent_id, task_id, approval_id, approval_state,
          approval_requested_at, approval_expires_at, approval_decided_at, approval_reason)
       VALUES ($1, $2, $3, 'DOMAIN', 'OWNER', $4, 'APPROVAL_STATE_CHANGED',
               $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        sequence,
        eventId,
        occurredAt,
        commandId,
        row.agent_id,
        row.task_id,
        state.approvalId,
        state.type,
        state.type === "PENDING" ? state.requestedAt : null,
        state.type === "PENDING" ? state.expiresAt : null,
        state.type === "PENDING" ? null : state.decidedAt,
        state.type === "DENIED" || state.type === "REVOKED" ? state.reason : null,
      ],
    );
  }

  private async appendStatusEvent(
    client: TransactionClient,
    row: ApprovalTaskRow,
    commandId: string,
    occurredAt: string,
    run: Run,
    status: "QUEUED" | "IDLE",
  ): Promise<void> {
    const eventId = EventIdSchema.parse(this.eventId());
    const sequence = await nextSequence(client);
    await client.query(
      `INSERT INTO agent_world.world_events
         (sequence, id, occurred_at, source_kind, source_actor, command_id,
          event_type, agent_id, status, task_id, run_id)
       VALUES ($1, $2, $3, 'DOMAIN', 'SYSTEM_POLICY', $4,
               'AGENT_STATUS_CHANGED', $5, $6, $7, $8)`,
      [sequence, eventId, occurredAt, commandId, row.agent_id, status, row.task_id, run.id],
    );
    await client.query(
      `INSERT INTO agent_world.world_agent_status
         (agent_id, status, last_event_id, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (agent_id) DO UPDATE
         SET status = EXCLUDED.status,
             last_event_id = EXCLUDED.last_event_id,
             updated_at = EXCLUDED.updated_at`,
      [row.agent_id, status, eventId, occurredAt],
    );
  }
}
