import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import {
  NativeChatControlStoreError,
  PostgresNativeChatControlStore,
} from "./native-chat-control-store.js";

const ids = {
  account: "account_11111111-1111-1111-1111-111111111111",
  agent: "agent_22222222-2222-2222-2222-222222222222",
  dispatch: "chat_dispatch_33333333-3333-3333-3333-333333333333",
  route: "route_44444444-4444-4444-4444-444444444444",
  run: "run_55555555-5555-5555-5555-555555555555",
  task: "task_66666666-6666-6666-6666-666666666666",
} as const;

const dispatchRow = {
  id: ids.dispatch,
  run_id: ids.run,
  task_id: ids.task,
  agent_id: ids.agent,
  account_id: ids.account,
  route_id: ids.route,
  state: "BROWSER_SUBMITTED",
  last_sequence: 0,
  created_at: "2026-08-14T10:00:00.000Z",
  submitted_at: "2026-08-14T10:01:00.000Z",
  attached_at: null,
  failed_at: null,
  failure_code: null,
  begin_deadline_at: "2026-08-14T10:30:00.000Z",
  completion_deadline_at: null,
  run_status: "DISPATCH_PENDING",
  adapter_kind: "NATIVE_CHATGPT",
  run_created_at: "2026-08-14T10:00:00.000Z",
};

function pool(rows: unknown[][]) {
  const query = vi.fn();
  for (const result of rows) query.mockResolvedValueOnce({ rows: result });
  const release = vi.fn();
  return {
    query,
    release,
    value: { connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionPool,
  };
}

describe("PostgresNativeChatControlStore", () => {
  it("atomically attaches an authenticated Account and starts the canonical Run", async () => {
    const fake = pool([
      [],
      [],
      [],
      [dispatchRow],
      [],
      [],
      [],
      [{ last_sequence: "12" }],
      [],
      [],
      [],
      [],
    ]);
    const result = await new PostgresNativeChatControlStore(fake.value, {
      eventId: () => "event_77777777-7777-7777-7777-777777777777",
      now: () => new Date("2026-08-14T10:02:00.000Z"),
    }).append(ids.account, {
      schemaVersion: 1,
      runId: ids.run,
      sequence: 1,
      idempotencyKey: "chat:begin:1",
      eventType: "BEGIN_RUN",
      payload: {},
    });

    expect(result).toMatchObject({
      outcome: "APPENDED",
      state: { status: "RUNNING", lastSequence: 1 },
    });
    expect(fake.query.mock.calls.map(([sql]) => String(sql))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("native_chat_control_events"),
        expect.stringContaining("UPDATE agent_world.runs"),
        expect.stringContaining("AGENT_STATUS_CHANGED"),
      ]),
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("replays an exact idempotency key without appending another event", async () => {
    const existing = {
      account_id: ids.account,
      run_id: ids.run,
      sequence: 1,
      event_type: "BEGIN_RUN",
      payload: {},
      event_sha256: "f".repeat(64),
    };
    const fake = pool([[], [], [existing], []]);
    const store = new PostgresNativeChatControlStore(fake.value, {
      hashEvent: () => "f".repeat(64),
    });
    await expect(
      store.append(ids.account, {
        schemaVersion: 1,
        runId: ids.run,
        sequence: 1,
        idempotencyKey: "chat:begin:1",
        eventType: "BEGIN_RUN",
        payload: {},
      }),
    ).resolves.toMatchObject({ outcome: "REPLAY" });
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("rejects a forged Account, skipped sequence and writes after terminal state", async () => {
    const otherAccount = "account_99999999-9999-9999-9999-999999999999";
    const forged = pool([[], [], [], [dispatchRow], []]);
    await expect(
      new PostgresNativeChatControlStore(forged.value).append(otherAccount, {
        schemaVersion: 1,
        runId: ids.run,
        sequence: 1,
        idempotencyKey: "chat:begin:1",
        eventType: "BEGIN_RUN",
        payload: {},
      }),
    ).rejects.toEqual(new NativeChatControlStoreError("ACCOUNT_MISMATCH"));

    const running = { ...dispatchRow, state: "ATTACHED", last_sequence: 1, run_status: "RUNNING" };
    const skipped = pool([[], [], [], [running], []]);
    await expect(
      new PostgresNativeChatControlStore(skipped.value).append(ids.account, {
        schemaVersion: 1,
        runId: ids.run,
        sequence: 3,
        idempotencyKey: "chat:finding:3",
        eventType: "FINDING",
        payload: { statement: "Skipped", confidence: 0.5 },
      }),
    ).rejects.toEqual(new NativeChatControlStoreError("SEQUENCE_CONFLICT"));

    const terminal = { ...running, last_sequence: 2, run_status: "COMPLETED" };
    const late = pool([[], [], [], [terminal], []]);
    await expect(
      new PostgresNativeChatControlStore(late.value).append(ids.account, {
        schemaVersion: 1,
        runId: ids.run,
        sequence: 3,
        idempotencyKey: "chat:late:3",
        eventType: "HEARTBEAT",
        payload: { progress: "Too late" },
      }),
    ).rejects.toEqual(new NativeChatControlStoreError("RUN_TERMINAL"));

    const expired = pool([
      [],
      [],
      [],
      [{ ...dispatchRow, begin_deadline_at: "2026-08-14T10:01:00.000Z" }],
      [],
    ]);
    await expect(
      new PostgresNativeChatControlStore(expired.value, {
        now: () => new Date("2026-08-14T10:02:00.000Z"),
      }).append(ids.account, {
        schemaVersion: 1,
        runId: ids.run,
        sequence: 1,
        idempotencyKey: "chat:expired:1",
        eventType: "BEGIN_RUN",
        payload: {},
      }),
    ).rejects.toEqual(new NativeChatControlStoreError("CAPABILITY_EXPIRED"));
  });

  it("materializes the committed result and Memory Inbox proposals in the same transaction", async () => {
    const running = {
      ...dispatchRow,
      project_id: "project_88888888-8888-8888-8888-888888888888",
      state: "ATTACHED",
      last_sequence: 1,
      run_status: "RUNNING",
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM agent_world.native_chat_control_events")) return { rows: [] };
      if (sql.includes("JOIN agent_world.runs")) return { rows: [running] };
      if (sql.includes("UPDATE agent_world.world_event_stream")) {
        return { rows: [{ last_sequence: "13" }] };
      }
      if (sql.includes("INSERT INTO agent_world.context_items")) {
        return { rows: [{ id: "context_item_99999999-9999-9999-9999-999999999999" }] };
      }
      if (sql.includes("INSERT INTO agent_world.memory_proposals")) {
        return { rows: [{ id: "memory_proposal_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }] };
      }
      return { rows: [] };
    });
    const transactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as unknown as TransactionPool;

    await new PostgresNativeChatControlStore(transactionPool, {
      eventId: () => "event_77777777-7777-7777-7777-777777777777",
      contextItemId: () => "context_item_99999999-9999-9999-9999-999999999999",
      memoryProposalId: () => "memory_proposal_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      memoryEventId: () => "event_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      now: () => new Date("2026-08-14T10:03:00.000Z"),
    }).append(ids.account, {
      schemaVersion: 1,
      runId: ids.run,
      sequence: 2,
      idempotencyKey: "chat:commit:2",
      eventType: "COMMIT_RESULT",
      payload: {
        result: {
          schemaVersion: 1,
          fullOutput: "Completed work.",
          summary: "Verified reusable result.",
          findings: [],
          decisions: [],
          actions: [],
          artifacts: [],
          openQuestions: [],
          nextActions: [],
          memoryCandidates: [
            { statement: "Use rotating OAuth refresh tokens.", confidence: 0.9, importance: 0.8 },
          ],
          confidence: 0.9,
        },
      },
    });

    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toEqual(
      expect.arrayContaining([
        expect.stringContaining("INSERT INTO agent_world.context_items"),
        expect.stringContaining("INSERT INTO agent_world.memory_proposals"),
        expect.stringContaining("INSERT INTO agent_world.memory_events"),
      ]),
    );
    expect(query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("reconciles a missing begin into one canonical terminal event", async () => {
    const expired = {
      ...dispatchRow,
      begin_deadline_at: "2026-08-14T10:05:00.000Z",
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT d.run_id, d.account_id, d.state")) {
        return {
          rows: [
            {
              run_id: ids.run,
              account_id: ids.account,
              state: "BROWSER_SUBMITTED",
              last_sequence: 0,
            },
          ],
        };
      }
      if (sql.includes("FROM agent_world.native_chat_control_events")) return { rows: [] };
      if (sql.includes("SELECT d.id, d.run_id")) return { rows: [expired] };
      if (sql.includes("UPDATE agent_world.world_event_stream")) {
        return { rows: [{ last_sequence: "14" }] };
      }
      return { rows: [] };
    });
    const transactionPool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as unknown as TransactionPool;

    await expect(
      new PostgresNativeChatControlStore(transactionPool, {
        eventId: () => "event_77777777-7777-7777-7777-777777777777",
        now: () => new Date("2026-08-14T10:06:00.000Z"),
      }).reconcileExpired(10),
    ).resolves.toMatchObject({ candidates: 1, reconciled: 1, raced: 0 });

    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toEqual(
      expect.arrayContaining([
        expect.stringContaining("native_chat_control_events"),
        expect.stringContaining("GREATEST(attempt, 1)"),
        expect.stringContaining("AGENT_STATUS_CHANGED"),
      ]),
    );
    expect(query.mock.calls.filter(([sql]) => sql === "COMMIT")).toHaveLength(1);
  });
});
