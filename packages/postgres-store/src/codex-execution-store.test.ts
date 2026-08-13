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

const jobRow = {
  id: "codex_execution_88888888-8888-8888-8888-888888888888",
  run_id: request.runId,
  task_id: request.taskId,
  agent_id: request.agentId,
  binding_id: request.bindingId,
  route_id: request.routeId,
  account_id: request.accountId,
  session_id: request.sessionId,
  idempotency_key: request.idempotencyKey,
  codex_thread_id: request.codexThreadId,
  prompt: request.prompt,
  working_directory: request.policy.workingDirectory,
  sandbox: request.policy.sandbox,
  approval_policy: request.policy.approvalPolicy,
  network_access: request.policy.networkAccess,
  timeout_ms: request.policy.timeoutMs,
  model: null,
  reasoning_effort: null,
  status: "LEASED",
  lease_owner: "worker-1",
  lease_expires_at: "2026-08-13T12:01:00.000Z",
  attempt: 1,
  accepted_at: "2026-08-13T12:00:00.000Z",
  started_at: null,
  completed_at: null,
  failure_code: null,
  final_output: null,
  input_tokens: null,
  cached_input_tokens: null,
  output_tokens: null,
  updated_at: "2026-08-13T12:00:00.000Z",
};

describe("PostgresCodexExecutionStore worker lifecycle", () => {
  it("claims one queued request with a bounded lease", async () => {
    const client: TransactionClient = {
      async query<Row>(text: string) {
        if (text.includes("UPDATE agent_world.codex_execution_jobs AS job")) {
          return { rows: [jobRow] as Row[] };
        }
        return { rows: [] as Row[] };
      },
      release() {},
    };
    const store = new PostgresCodexExecutionStore(
      { connect: async () => client },
      { now: () => "2026-08-13T12:00:00.000Z" },
    );

    await expect(store.claim("worker-1", 60_000)).resolves.toEqual({
      externalRunId: jobRow.id,
      attempt: 1,
      leaseExpiresAt: "2026-08-13T12:01:00.000Z",
      request,
    });
  });

  it("renews only the active worker lease", async () => {
    const updates: unknown[][] = [];
    const client: TransactionClient = {
      async query<Row>(text: string, values: unknown[] = []) {
        if (text.includes("SET lease_expires_at")) {
          updates.push(values);
          return { rows: [{ id: jobRow.id }] as Row[] };
        }
        return { rows: [] as Row[] };
      },
      release() {},
    };
    const store = new PostgresCodexExecutionStore(
      { connect: async () => client },
      { now: () => "2026-08-13T12:00:30.000Z" },
    );

    await expect(store.renewLease(jobRow.id, "worker-1", 60_000)).resolves.toEqual({
      leaseExpiresAt: "2026-08-13T12:01:30.000Z",
    });
    expect(updates).toEqual([
      [jobRow.id, "worker-1", "2026-08-13T12:00:30.000Z", "2026-08-13T12:01:30.000Z"],
    ]);
  });

  it("appends an event once and replays only its exact fingerprint", async () => {
    const events = new Map<number, string>();
    let status = "LEASED";
    const client: TransactionClient = {
      async query<Row>(text: string, values: unknown[] = []) {
        if (text.includes("FROM agent_world.codex_execution_jobs") && text.includes("FOR UPDATE")) {
          return { rows: [{ ...jobRow, status }] as Row[] };
        }
        if (
          text.includes("FROM agent_world.codex_execution_events") &&
          text.includes("sequence =")
        ) {
          const fingerprint = events.get(Number(values[1]));
          return { rows: (fingerprint ? [{ event_sha256: fingerprint }] : []) as Row[] };
        }
        if (text.includes("max(sequence)")) {
          return { rows: [{ last_sequence: events.size }] as Row[] };
        }
        if (text.includes("INSERT INTO agent_world.codex_execution_events")) {
          events.set(Number(values[1]), String(values[4]));
        }
        if (text.includes("SET status = 'RUNNING'")) status = "RUNNING";
        return { rows: [] as Row[] };
      },
      release() {},
    };
    const store = new PostgresCodexExecutionStore(
      { connect: async () => client },
      { now: () => "2026-08-13T12:00:01.000Z" },
    );
    const event = {
      schemaVersion: 1,
      sequence: 1,
      eventType: "RUN_STARTED",
      occurredAt: "2026-08-13T12:00:01.000Z",
      threadId: request.codexThreadId,
    } as const;

    await expect(store.appendEvent(jobRow.id, "worker-1", event)).resolves.toEqual({
      outcome: "APPLIED",
      sequence: 1,
    });
    await expect(store.appendEvent(jobRow.id, "worker-1", event)).resolves.toEqual({
      outcome: "REPLAY",
      sequence: 1,
    });
    await expect(
      store.appendEvent(jobRow.id, "worker-1", { ...event, threadId: "different-thread" }),
    ).rejects.toMatchObject({ code: "EVENT_CONFLICT" });
    await expect(
      store.appendEvent(jobRow.id, "worker-1", {
        schemaVersion: 1,
        sequence: 2,
        eventType: "ITEM_COMPLETED",
        occurredAt: "2026-08-13T11:59:59.000Z",
        itemId: "item-out-of-order",
        itemType: "COMMAND",
      }),
    ).rejects.toMatchObject({ code: "LEASE_CONFLICT" });
    expect(events).toHaveLength(1);
  });

  it("bounds persistence failures while observing", async () => {
    const client: TransactionClient = {
      async query() {
        throw new Error("private database locator");
      },
      release() {},
    };
    const store = new PostgresCodexExecutionStore({ connect: async () => client });

    await expect(store.observe(jobRow.id, 0)).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED",
      message: "PERSISTENCE_FAILED",
    });
  });

  it("records expired running leases as interrupted instead of rerunning them", async () => {
    const inserted: unknown[][] = [];
    const client: TransactionClient = {
      async query<Row>(text: string, values: unknown[] = []) {
        if (text.includes("WHERE status IN ('LEASED', 'RUNNING')") && text.includes("FOR UPDATE")) {
          return { rows: [{ ...jobRow, status: "RUNNING" }] as Row[] };
        }
        if (text.includes("max(sequence)")) return { rows: [{ last_sequence: 2 }] as Row[] };
        if (text.includes("INSERT INTO agent_world.codex_execution_events")) inserted.push(values);
        return { rows: [] as Row[] };
      },
      release() {},
    };
    const store = new PostgresCodexExecutionStore(
      { connect: async () => client },
      { now: () => "2026-08-13T12:02:00.000Z" },
    );

    await expect(store.recoverExpired()).resolves.toEqual({ interrupted: 1 });
    expect(inserted[0]?.[1]).toBe(3);
    expect(inserted[0]).toContain("WORKER_INTERRUPTED");
  });
});
