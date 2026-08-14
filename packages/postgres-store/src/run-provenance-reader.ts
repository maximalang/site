import { RunIdSchema } from "@agent-world/domain";
import { ExecutionProvenanceSchema } from "@agent-world/read-model";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

type ProvenanceRow = QueryResultRow & {
  route_id: string;
  account_id: string | null;
  mode: string;
  adapter_kind: string;
  model_route_id: string | null;
  remote_model_id: string | null;
};

export class PostgresRunProvenanceReader {
  constructor(private readonly pool: TransactionPool) {}

  async read(runIdValue: unknown) {
    const runId = RunIdSchema.parse(runIdValue);
    const client = await this.pool.connect();
    try {
      const result = await client.query<ProvenanceRow>(
        `SELECT route.id AS route_id, route.account_id, route.mode,
                route.adapter_kind, route.model_route_id, model.remote_model_id
           FROM agent_world.runs run
           LEFT JOIN agent_world.runtime_bindings binding
             ON binding.id = run.binding_id
            AND binding.agent_id = run.agent_id
            AND binding.adapter_kind = run.adapter_kind
           JOIN agent_world.execution_routes route
             ON route.id = CASE
                  WHEN run.adapter_kind = 'NATIVE_CHATGPT' THEN run.route_id
                  ELSE binding.route_id
                END
            AND route.adapter_kind = run.adapter_kind
            AND (
              run.adapter_kind <> 'NATIVE_CHATGPT'
              OR route.account_id IS NOT DISTINCT FROM run.account_id
            )
           LEFT JOIN agent_world.model_routes model ON model.id = route.model_route_id
          WHERE run.id = $1
          LIMIT 2`,
        [runId],
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new Error("RUN_PROVENANCE_UNAVAILABLE");
      }
      const row = result.rows[0];
      return ExecutionProvenanceSchema.parse({
        routeId: row.route_id,
        ...(row.account_id === null ? {} : { accountId: row.account_id }),
        mode: row.mode,
        adapterKind: row.adapter_kind,
        ...(row.model_route_id === null ? {} : { modelRouteId: row.model_route_id }),
        ...(row.remote_model_id === null ? {} : { remoteModelId: row.remote_model_id }),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "RUN_PROVENANCE_UNAVAILABLE") throw error;
      throw new Error("RUN_PROVENANCE_UNAVAILABLE");
    } finally {
      client.release();
    }
  }
}
