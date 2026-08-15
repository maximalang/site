import { type OperationsReadModel, OperationsReadModelSchema } from "@agent-world/read-model";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

type Row = QueryResultRow & Record<string, unknown>;

function iso(value: unknown): string {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

function count(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid operations aggregate");
  return parsed;
}

function summary(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = text.trim().slice(0, 2_000);
  return normalized || undefined;
}

export class PostgresOperationsReader {
  constructor(
    private readonly pool: TransactionPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(): Promise<OperationsReadModel> {
    const generatedAt = this.now().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const tasks = await client.query<Row>(
        `SELECT task.id, task.title, task.assignee_agent_id, task.created_at,
                run.status AS run_status
           FROM agent_world.tasks task
           LEFT JOIN agent_world.runs run ON run.task_id = task.id
          ORDER BY task.created_at DESC, task.id DESC LIMIT 201`,
      );
      const runs = await client.query<Row>(
        `SELECT run.id, run.task_id, run.agent_id, run.status, run.adapter_kind,
                run.created_at, task.title,
                COALESCE(codex.structured_result, native.structured_result, model.result) AS structured_result,
                codex.final_output
           FROM agent_world.runs run
           JOIN agent_world.tasks task ON task.id = run.task_id
           LEFT JOIN agent_world.codex_execution_jobs codex ON codex.run_id = run.id
           LEFT JOIN agent_world.native_chat_results native ON native.run_id = run.id
           LEFT JOIN agent_world.model_execution_jobs model ON model.run_id = run.id
          ORDER BY run.created_at DESC, run.id DESC LIMIT 201`,
      );
      const handoffs = await client.query<Row>(
        `SELECT id, from_task_id, to_task_id, from_run_id, occurred_at
           FROM agent_world.mission_handoffs
          ORDER BY occurred_at DESC, sequence DESC LIMIT 401`,
      );
      if (tasks.rows.length > 200 || runs.rows.length > 200 || handoffs.rows.length > 400) {
        throw new Error("Operations graph exceeds its bounded read limit");
      }
      const usage = await client.query<Row>(
        `WITH token_usage AS (
           SELECT input_tokens, cached_input_tokens, output_tokens
             FROM agent_world.codex_execution_jobs
            WHERE input_tokens IS NOT NULL
           UNION ALL
           SELECT input_tokens, cached_input_tokens, output_tokens
             FROM agent_world.model_execution_jobs
            WHERE input_tokens IS NOT NULL
         )
         SELECT (SELECT count(*)::bigint FROM agent_world.runs) AS total,
                (SELECT count(*)::bigint FROM agent_world.runs WHERE status = 'COMPLETED') AS completed,
                (SELECT count(*)::bigint FROM agent_world.runs WHERE status = 'FAILED') AS failed,
                COALESCE(sum(input_tokens), 0)::bigint AS input_tokens,
                COALESCE(sum(cached_input_tokens), 0)::bigint AS cached_input_tokens,
                COALESCE(sum(output_tokens), 0)::bigint AS output_tokens,
                (SELECT COALESCE(sum(cost_usd), 0)::text
                   FROM agent_world.model_execution_jobs WHERE cost_usd IS NOT NULL) AS cost_usd,
                (SELECT count(*)::bigint
                   FROM agent_world.model_execution_jobs WHERE cost_usd IS NOT NULL) AS cost_jobs
           FROM token_usage`,
      );
      const context = await client.query<Row>(
        `SELECT COALESCE(sum(estimated_tokens), 0)::bigint AS estimated_tokens,
                COALESCE(sum(token_budget), 0)::bigint AS budget_tokens
           FROM agent_world.context_packs`,
      );
      const signals = await client.query<Row>(
        `SELECT DISTINCT ON (route_id) route_id, is_available, quality,
                remaining_limits, cost, speed, load, observed_at, expires_at
           FROM agent_world.resource_route_observations
          ORDER BY route_id, observed_at DESC LIMIT 201`,
      );
      if (signals.rows.length > 200)
        throw new Error("Route signals exceed their bounded read limit");
      await client.query("COMMIT");

      const usageRow = usage.rows[0] ?? {};
      const contextRow = context.rows[0] ?? {};
      const estimatedTokens = count(contextRow.estimated_tokens);
      const budgetTokens = count(contextRow.budget_tokens);
      const costJobs = count(usageRow.cost_jobs);
      const amountUsd = Number(usageRow.cost_usd ?? 0);
      if (!Number.isFinite(amountUsd) || amountUsd < 0) {
        throw new Error("Invalid monetary cost aggregate");
      }
      return OperationsReadModelSchema.parse({
        schemaVersion: 1,
        generatedAt,
        actionGraph: {
          nodes: [
            ...tasks.rows.map((row) => ({
              kind: "TASK" as const,
              id: row.id,
              label: row.title,
              agentId: row.assignee_agent_id,
              status:
                row.run_status === "COMPLETED"
                  ? ("COMPLETED" as const)
                  : row.run_status === "FAILED"
                    ? ("FAILED" as const)
                    : row.run_status
                      ? ("ACTIVE" as const)
                      : ("PENDING" as const),
              occurredAt: iso(row.created_at),
            })),
            ...runs.rows.map((row) => ({
              kind: "RUN" as const,
              id: row.id,
              label: row.title,
              taskId: row.task_id,
              agentId: row.agent_id,
              status: row.status,
              adapterKind: row.adapter_kind,
              occurredAt: iso(row.created_at),
              ...(summary(row.structured_result ?? row.final_output) === undefined
                ? {}
                : { resultSummary: summary(row.structured_result ?? row.final_output) }),
            })),
          ],
          edges: [
            ...runs.rows.map((row) => ({
              kind: "EXECUTION" as const,
              fromTaskId: row.task_id,
              toRunId: row.id,
            })),
            ...handoffs.rows.map((row) => ({
              kind: "HANDOFF" as const,
              id: row.id,
              fromTaskId: row.from_task_id,
              toTaskId: row.to_task_id,
              fromRunId: row.from_run_id,
              occurredAt: iso(row.occurred_at),
            })),
          ],
        },
        observatory: {
          runs: {
            total: count(usageRow.total),
            completed: count(usageRow.completed),
            failed: count(usageRow.failed),
          },
          tokens: {
            input: count(usageRow.input_tokens),
            cachedInput: count(usageRow.cached_input_tokens),
            output: count(usageRow.output_tokens),
          },
          context: {
            estimatedTokens,
            budgetTokens,
            pressure: budgetTokens === 0 ? 0 : Math.min(1, estimatedTokens / budgetTokens),
          },
          monetaryCost:
            costJobs === 0
              ? { status: "UNAVAILABLE" }
              : {
                  status: "ESTIMATED",
                  amountUsd,
                  source: "LITELLM_RESPONSE_HEADER",
                  jobCount: costJobs,
                },
          routeSignals: signals.rows.map((row) => ({
            routeId: row.route_id,
            isAvailable: row.is_available,
            quality: Number(row.quality),
            remainingLimits: Number(row.remaining_limits),
            costEfficiency: Number(row.cost),
            speed: Number(row.speed),
            loadHeadroom: Number(row.load),
            observedAt: iso(row.observed_at),
            expiresAt: iso(row.expires_at),
            isFresh: Date.parse(iso(row.expires_at)) > Date.parse(generatedAt),
          })),
        },
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
