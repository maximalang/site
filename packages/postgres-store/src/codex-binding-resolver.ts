import { CodexExecutionPolicySchema } from "@agent-world/codex-adapter";
import {
  AccountIdSchema,
  AgentIdSchema,
  BindingIdSchema,
  OpaqueExternalIdSchema,
  RouteIdSchema,
  RunIdSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import * as z from "zod";
import type { TransactionPool } from "./conversation-store.js";

const ResolveInputSchema = z.strictObject({
  runId: RunIdSchema,
  bindingId: BindingIdSchema,
  agentId: AgentIdSchema,
  externalAgentId: OpaqueExternalIdSchema,
});

type ResolutionRow = QueryResultRow & {
  route_id: string;
  account_id: string;
  working_directory: string;
  sandbox: string;
  approval_policy: string;
  network_access: boolean;
  timeout_ms: number;
  model: string | null;
  reasoning_effort: string | null;
};

export class CodexBindingResolutionError extends Error {
  override readonly name = "CodexBindingResolutionError";

  constructor(readonly code: "INVALID_INPUT" | "ROUTE_UNAVAILABLE") {
    super(code);
  }
}

export class PostgresCodexBindingResolver {
  constructor(private readonly pool: TransactionPool) {}

  async resolve(inputValue: unknown) {
    const parsed = ResolveInputSchema.safeParse(inputValue);
    if (!parsed.success) throw new CodexBindingResolutionError("INVALID_INPUT");
    const input = parsed.data;
    const client = await this.pool.connect();
    try {
      const result = await client.query<ResolutionRow>(
        `SELECT r.id AS route_id, r.account_id, p.working_directory, p.sandbox,
                p.approval_policy, p.network_access, p.timeout_ms, p.model,
                p.reasoning_effort
           FROM agent_world.runs run
           JOIN agent_world.runtime_bindings b
             ON b.id = run.binding_id
            AND b.agent_id = run.agent_id
            AND b.adapter_kind = run.adapter_kind
           JOIN agent_world.execution_routes r
             ON r.id = b.route_id
            AND r.adapter_kind = b.adapter_kind
           JOIN agent_world.accounts a ON a.id = r.account_id
           JOIN agent_world.account_surfaces surface
             ON surface.account_id = a.id
            AND surface.surface = 'CODEX'
           JOIN agent_world.codex_execution_policies p
             ON p.route_id = r.id
            AND p.account_id = a.id
            AND p.adapter_kind = r.adapter_kind
            AND p.mode = r.mode
          WHERE run.id = $1
            AND b.id = $2
            AND b.agent_id = $3
            AND b.external_agent_id = $4
            AND run.adapter_kind = 'CODEX'
            AND r.adapter_kind = 'CODEX'
            AND r.mode = 'CODEX'
            AND a.auth_mechanism = 'CHATGPT_INTERACTIVE'
            AND a.health = 'ACTIVE'
            AND run.status IN ('DISPATCH_PENDING', 'DISPATCHING', 'RUNNING')
            AND b.is_enabled = true
            AND r.is_enabled = true
            AND a.is_enabled = true
          LIMIT 2`,
        [input.runId, input.bindingId, input.agentId, input.externalAgentId],
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new CodexBindingResolutionError("ROUTE_UNAVAILABLE");
      }
      const row = result.rows[0];
      return {
        routeId: RouteIdSchema.parse(row.route_id),
        accountId: AccountIdSchema.parse(row.account_id),
        policy: CodexExecutionPolicySchema.parse({
          workingDirectory: row.working_directory,
          sandbox: row.sandbox,
          approvalPolicy: row.approval_policy,
          networkAccess: row.network_access,
          timeoutMs: row.timeout_ms,
          ...(row.model === null ? {} : { model: row.model }),
          ...(row.reasoning_effort === null ? {} : { reasoningEffort: row.reasoning_effort }),
        }),
      };
    } catch (error) {
      if (error instanceof CodexBindingResolutionError) throw error;
      throw new CodexBindingResolutionError("ROUTE_UNAVAILABLE");
    } finally {
      client.release();
    }
  }
}
