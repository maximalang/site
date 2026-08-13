import { describe, expect, it } from "vitest";
import { PostgresCodexBindingResolver } from "./codex-binding-resolver.js";
import type { TransactionClient, TransactionPool } from "./conversation-store.js";

const input = {
  runId: "run_11111111-1111-1111-1111-111111111111",
  bindingId: "binding_22222222-2222-2222-2222-222222222222",
  agentId: "agent_33333333-3333-3333-3333-333333333333",
  externalAgentId: "codex-agent",
};

function database(rows: unknown[]) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const client: TransactionClient = {
    async query<Row>(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      return { rows: rows as Row[] };
    },
    release() {},
  };
  return { pool: { connect: async () => client } satisfies TransactionPool, queries };
}

describe("PostgresCodexBindingResolver", () => {
  it("returns only a fully enabled ChatGPT Codex route with its canonical policy", async () => {
    const fixture = database([
      {
        route_id: "route_44444444-4444-4444-4444-444444444444",
        account_id: "account_55555555-5555-5555-5555-555555555555",
        working_directory: "/workspaces/project",
        sandbox: "WORKSPACE_WRITE",
        approval_policy: "ON_REQUEST",
        network_access: false,
        timeout_ms: 600000,
        model: null,
        reasoning_effort: "HIGH",
      },
    ]);

    await expect(new PostgresCodexBindingResolver(fixture.pool).resolve(input)).resolves.toEqual({
      routeId: "route_44444444-4444-4444-4444-444444444444",
      accountId: "account_55555555-5555-5555-5555-555555555555",
      policy: {
        workingDirectory: "/workspaces/project",
        sandbox: "WORKSPACE_WRITE",
        approvalPolicy: "ON_REQUEST",
        networkAccess: false,
        timeoutMs: 600000,
        reasoningEffort: "HIGH",
      },
    });
    expect(fixture.queries[0]?.values).toEqual([
      input.runId,
      input.bindingId,
      input.agentId,
      input.externalAgentId,
    ]);
    expect(fixture.queries[0]?.text).toContain("a.auth_mechanism = 'CHATGPT_INTERACTIVE'");
    expect(fixture.queries[0]?.text).toContain("a.health = 'ACTIVE'");
    expect(fixture.queries[0]?.text).toContain("worker.authentication = 'CHATGPT'");
    expect(fixture.queries[0]?.text).toContain("interval '90 seconds'");
    expect(fixture.queries[0]?.text).toContain("r.adapter_kind = 'CODEX'");
  });

  it("fails closed when no exact ready route exists", async () => {
    const fixture = database([]);
    await expect(
      new PostgresCodexBindingResolver(fixture.pool).resolve(input),
    ).rejects.toMatchObject({
      code: "ROUTE_UNAVAILABLE",
    });
  });

  it("fails closed on ambiguous provenance", async () => {
    const row = {
      route_id: "route_44444444-4444-4444-4444-444444444444",
      account_id: "account_55555555-5555-5555-5555-555555555555",
      working_directory: "/workspaces/project",
      sandbox: "READ_ONLY",
      approval_policy: "NEVER",
      network_access: false,
      timeout_ms: 600000,
      model: null,
      reasoning_effort: null,
    };
    await expect(
      new PostgresCodexBindingResolver(database([row, row]).pool).resolve(input),
    ).rejects.toMatchObject({
      code: "ROUTE_UNAVAILABLE",
    });
  });
});
