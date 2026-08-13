import type { AgentId, ProjectId, TaskId } from "@agent-world/domain";
import {
  type ExecutionPreferenceLayer,
  ExecutionPreferenceLayerSchema,
  type ResolvedExecutionPreferences,
  resolveExecutionPreferences,
} from "@agent-world/read-model";
import type { QueryResultRow } from "pg";
import type { TransactionClient, TransactionPool } from "./conversation-store.js";

export type ResolveExecutionPreferencesInput = {
  projectId?: ProjectId;
  agentId?: AgentId;
  taskId?: TaskId;
};

type PreferenceRow = QueryResultRow & {
  scope_kind: "SYSTEM" | "PROJECT" | "AGENT" | "TASK";
  project_id: ProjectId | null;
  agent_id: AgentId | null;
  task_id: TaskId | null;
  model_selection: "AUTO" | "MODEL" | null;
  model_id: string | null;
  account_selection: "AUTO" | "ACCOUNT" | null;
  account_id: string | null;
  mode: "AUTO" | "CHAT" | "WORK" | "CODEX" | "API" | "LOCAL" | null;
  context_policy: "AUTO" | "LEAN" | "BALANCED" | "RICH" | null;
  budget_policy: "AUTO" | "ECONOMY" | "BALANCED" | "QUALITY" | null;
};

function scope(row: PreferenceRow): ExecutionPreferenceLayer["scope"] {
  switch (row.scope_kind) {
    case "SYSTEM":
      return { kind: "SYSTEM" };
    case "PROJECT":
      return { kind: "PROJECT", projectId: row.project_id as ProjectId };
    case "AGENT":
      return { kind: "AGENT", agentId: row.agent_id as AgentId };
    case "TASK":
      return { kind: "TASK", taskId: row.task_id as TaskId };
  }
}

function layer(row: PreferenceRow): ExecutionPreferenceLayer {
  return ExecutionPreferenceLayerSchema.parse({
    schemaVersion: 1,
    scope: scope(row),
    overrides: {
      ...(row.model_selection === null
        ? {}
        : {
            model:
              row.model_selection === "AUTO"
                ? { kind: "AUTO" }
                : { kind: "MODEL", modelId: row.model_id },
          }),
      ...(row.account_selection === null
        ? {}
        : {
            account:
              row.account_selection === "AUTO"
                ? { kind: "AUTO" }
                : { kind: "ACCOUNT", accountId: row.account_id },
          }),
      ...(row.mode === null ? {} : { mode: row.mode }),
      ...(row.context_policy === null ? {} : { context: row.context_policy }),
      ...(row.budget_policy === null ? {} : { budget: row.budget_policy }),
    },
  });
}

function scopeColumns(value: ExecutionPreferenceLayer["scope"]) {
  return {
    projectId: value.kind === "PROJECT" ? value.projectId : null,
    agentId: value.kind === "AGENT" ? value.agentId : null,
    taskId: value.kind === "TASK" ? value.taskId : null,
  };
}

export class PostgresExecutionPreferenceStore {
  constructor(private readonly pool: TransactionPool) {}

  async resolve(input: ResolveExecutionPreferencesInput): Promise<ResolvedExecutionPreferences> {
    if (input.taskId && (!input.projectId || !input.agentId)) {
      throw new Error("INVALID_SCOPE_CHAIN");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        if (input.taskId) {
          const valid = (
            await client.query<{ valid: boolean }>(
              `SELECT EXISTS (
                 SELECT 1 FROM agent_world.tasks
                  WHERE id = $1 AND project_id = $2 AND assignee_agent_id = $3
               ) AS valid`,
              [input.taskId, input.projectId, input.agentId],
            )
          ).rows[0]?.valid;
          if (valid !== true) throw new Error("INVALID_SCOPE_CHAIN");
        }
        const rows = (
          await client.query<PreferenceRow>(
            `SELECT scope_kind, project_id, agent_id, task_id,
                    model_selection, model_id, account_selection, account_id,
                    mode, context_policy, budget_policy
               FROM agent_world.execution_preference_overrides
              WHERE scope_kind = 'SYSTEM'
                 OR (scope_kind = 'PROJECT' AND project_id = $1)
                 OR (scope_kind = 'AGENT' AND agent_id = $2)
                 OR (scope_kind = 'TASK' AND task_id = $3)
              ORDER BY CASE scope_kind
                WHEN 'SYSTEM' THEN 0 WHEN 'PROJECT' THEN 1
                WHEN 'AGENT' THEN 2 WHEN 'TASK' THEN 3 END`,
            [input.projectId ?? null, input.agentId ?? null, input.taskId ?? null],
          )
        ).rows;
        const resolved = resolveExecutionPreferences(rows.map(layer));
        await client.query("COMMIT");
        return resolved;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async writeLayer(input: ExecutionPreferenceLayer, updatedAt: string): Promise<void> {
    const value = ExecutionPreferenceLayerSchema.parse(input);
    if (value.scope.kind === "RUN") throw new Error("RUN_SCOPE_NOT_AVAILABLE");
    if (value.scope.kind === "SYSTEM") resolveExecutionPreferences([value]);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const columns = scopeColumns(value.scope);
        if (Object.keys(value.overrides).length === 0) {
          await client.query(
            `DELETE FROM agent_world.execution_preference_overrides
              WHERE scope_kind = $1
                AND project_id IS NOT DISTINCT FROM $2
                AND agent_id IS NOT DISTINCT FROM $3
                AND task_id IS NOT DISTINCT FROM $4`,
            [value.scope.kind, columns.projectId, columns.agentId, columns.taskId],
          );
        } else {
          const model = value.overrides.model;
          const account = value.overrides.account;
          await this.upsert(client, [
            value.scope.kind,
            columns.projectId,
            columns.agentId,
            columns.taskId,
            model?.kind ?? null,
            model?.kind === "MODEL" ? model.modelId : null,
            account?.kind ?? null,
            account?.kind === "ACCOUNT" ? account.accountId : null,
            value.overrides.mode ?? null,
            value.overrides.context ?? null,
            value.overrides.budget ?? null,
            updatedAt,
          ]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  private async upsert(client: TransactionClient, values: unknown[]): Promise<void> {
    await client.query(
      `INSERT INTO agent_world.execution_preference_overrides (
         scope_kind, project_id, agent_id, task_id, model_selection, model_id,
         account_selection, account_id, mode, context_policy, budget_policy, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (scope_key) DO UPDATE SET
         model_selection = EXCLUDED.model_selection,
         model_id = EXCLUDED.model_id,
         account_selection = EXCLUDED.account_selection,
         account_id = EXCLUDED.account_id,
         mode = EXCLUDED.mode,
         context_policy = EXCLUDED.context_policy,
         budget_policy = EXCLUDED.budget_policy,
         updated_at = EXCLUDED.updated_at`,
      values,
    );
  }
}
