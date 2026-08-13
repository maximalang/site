import { describe, expect, it } from "vitest";
import type { TransactionClient, TransactionPool } from "./conversation-store.js";
import { PostgresRunProvenanceReader } from "./run-provenance-reader.js";

function database(rows: unknown[]) {
  const client: TransactionClient = {
    async query<Row>() {
      return { rows: rows as Row[] };
    },
    release() {},
  };
  return { connect: async () => client } satisfies TransactionPool;
}

describe("PostgresRunProvenanceReader", () => {
  it("projects exact route, account, adapter, mode and model identities", async () => {
    await expect(
      new PostgresRunProvenanceReader(
        database([
          {
            route_id: "route_11111111-1111-1111-1111-111111111111",
            account_id: "account_22222222-2222-2222-2222-222222222222",
            mode: "CODEX",
            adapter_kind: "CODEX",
            model_route_id: "model_route_33333333-3333-3333-3333-333333333333",
            remote_model_id: "gpt-5.6-codex",
          },
        ]),
      ).read("run_44444444-4444-4444-4444-444444444444"),
    ).resolves.toEqual({
      routeId: "route_11111111-1111-1111-1111-111111111111",
      accountId: "account_22222222-2222-2222-2222-222222222222",
      mode: "CODEX",
      adapterKind: "CODEX",
      modelRouteId: "model_route_33333333-3333-3333-3333-333333333333",
      remoteModelId: "gpt-5.6-codex",
    });
  });

  it("fails closed on missing or ambiguous provenance", async () => {
    const runId = "run_44444444-4444-4444-4444-444444444444";
    await expect(new PostgresRunProvenanceReader(database([])).read(runId)).rejects.toThrow(
      "RUN_PROVENANCE_UNAVAILABLE",
    );
    await expect(new PostgresRunProvenanceReader(database([{}, {}])).read(runId)).rejects.toThrow(
      "RUN_PROVENANCE_UNAVAILABLE",
    );
  });
});
