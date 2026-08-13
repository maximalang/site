import { createHash } from "node:crypto";
import {
  type CodexExecutionRequest,
  CodexExecutionRequestSchema,
} from "@agent-world/codex-adapter";
import { TimestampSchema } from "@agent-world/domain";
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

export type CodexExecutionStoreErrorCode =
  | "INVALID_REQUEST"
  | "IDEMPOTENCY_CONFLICT"
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
}
