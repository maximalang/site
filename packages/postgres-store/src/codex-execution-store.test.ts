import { CodexExecutionRequestSchema } from "@agent-world/codex-adapter";
import { describe, expect, it } from "vitest";
import { PostgresCodexExecutionStore } from "./codex-execution-store.js";
import type { TransactionClient, TransactionPool } from "./conversation-store.js";

const request = CodexExecutionRequestSchema.parse({
  schemaVersion: 1,
  runId: "run_11111111-1111-1111-1111-111111111111",
  taskId: "task_22222222-2222-2222-2222-222222222222",
  agentId: "agent_33333333-3333-3333-3333-333333333333",
  bindingId: "binding_44444444-4444-4444-4444-444444444444",
  routeId: "route_55555555-5555-5555-5555-555555555555",
  accountId: "account_66666666-6666-6666-6666-666666666666",
  sessionId: "session_77777777-7777-7777-7777-777777777777",
  codexThreadId: "thread-opaque-1",
  idempotencyKey: "codex:run-1",
  prompt: "Verify the repository contracts.",
  policy: {
    workingDirectory: "C:/workspace/project",
    sandbox: "WORKSPACE_WRITE",
    approvalPolicy: "ON_REQUEST",
    networkAccess: false,
    timeoutMs: 60_000,
  },
});

function fakeDatabase() {
  const rows = new Map<string, { id: string; request_sha256: string; accepted_at: string }>();
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const client: TransactionClient = {
    async query<Row>(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      if (text.includes("FROM agent_world.codex_execution_jobs") && text.includes("FOR UPDATE")) {
        const row = rows.get(String(values[0]));
        return { rows: (row ? [row] : []) as Row[] };
      }
      if (text.includes("INSERT INTO agent_world.codex_execution_jobs")) {
        rows.set(String(values[1]), {
          id: String(values[0]),
          request_sha256: String(values[2]),
          accepted_at: String(values.at(-1)),
        });
      }
      return { rows: [] as Row[] };
    },
    release() {},
  };
  return {
    pool: { connect: async () => client } satisfies TransactionPool,
    queries,
  };
}

describe("PostgresCodexExecutionStore dispatch", () => {
  it("enqueues once and replays the exact idempotent request", async () => {
    const database = fakeDatabase();
    const store = new PostgresCodexExecutionStore(database.pool, {
      executionId: () => "codex_execution_88888888-8888-8888-8888-888888888888",
      now: () => "2026-08-13T12:00:00.000Z",
    });

    const first = await store.dispatch(request);
    const replay = await store.dispatch(request);

    expect(first).toEqual(replay);
    expect(first).toEqual({
      acceptedAt: "2026-08-13T12:00:00.000Z",
      externalRunId: "codex_execution_88888888-8888-8888-8888-888888888888",
    });
    expect(
      database.queries.filter(({ text }) =>
        text.includes("INSERT INTO agent_world.codex_execution_jobs"),
      ),
    ).toHaveLength(1);
  });

  it("rejects idempotency reuse with changed immutable input", async () => {
    const database = fakeDatabase();
    const store = new PostgresCodexExecutionStore(database.pool, {
      executionId: () => "codex_execution_88888888-8888-8888-8888-888888888888",
      now: () => "2026-08-13T12:00:00.000Z",
    });
    await store.dispatch(request);

    await expect(store.dispatch({ ...request, prompt: "Different task." })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("rejects malformed input before opening a transaction", async () => {
    const database = fakeDatabase();
    const store = new PostgresCodexExecutionStore(database.pool, {
      executionId: () => "codex_execution_88888888-8888-8888-8888-888888888888",
    });

    await expect(store.dispatch({ ...request, accountId: request.agentId })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(database.queries).toEqual([]);
  });
});
