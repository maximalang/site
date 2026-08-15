import { ResourceBrokerDecisionSchema } from "@agent-world/read-model";
import { describe, expect, it, vi } from "vitest";
import {
  ApprovalRunStoreError,
  isApprovalRunStoreError,
  PostgresApprovalRunStore,
} from "./approval-run-store.js";
import type { TransactionPool } from "./conversation-store.js";

const taskId = "task_11111111-1111-1111-1111-111111111111";
const approvalId = "approval_11111111-1111-1111-1111-111111111111";
const runId = "run_11111111-1111-1111-1111-111111111111";
const agentId = "agent_22222222-2222-2222-2222-222222222222";

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

const pendingApproval = {
  id: approvalId,
  task_id: taskId,
  state: "PENDING",
  requested_at: "2026-08-13T10:00:00.000Z",
  expires_at: "2026-08-13T10:15:00.000Z",
  decided_at: null,
  reason: null,
  decision_command_id: null,
  conversation_id: "conversation_33333333-3333-3333-3333-333333333333",
  project_id: "project_33333333-3333-3333-3333-333333333333",
  agent_id: agentId,
  dependencies_ready: true,
};

describe("PostgresApprovalRunStore", () => {
  it("recognizes only bounded approval decision errors", () => {
    expect(
      isApprovalRunStoreError({ name: "ApprovalRunStoreError", code: "APPROVAL_EXPIRED" }),
    ).toBe(true);
    expect(
      isApprovalRunStoreError({ name: "ApprovalRunStoreError", code: "DATABASE_SECRET" }),
    ).toBe(false);
  });

  it("refuses to approve a Mission Task before every dependency has a completed Run", async () => {
    const fake = pool([[], [], [{ ...pendingApproval, dependencies_ready: false }], []]);
    await expect(
      new PostgresApprovalRunStore(fake.value, {
        eventId: () => "event_88888888-8888-4888-8888-888888888888",
      }).decide({
        taskId,
        approvalId,
        decision: "APPROVE",
        commandId: "approval-decision:approve:11111111-1111-1111-1111-111111111111",
        decidedAt: "2026-08-13T10:05:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "DEPENDENCIES_INCOMPLETE" });
    expect(
      fake.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO agent_world.runs")),
    ).toBe(false);
    expect(fake.query).toHaveBeenLastCalledWith("ROLLBACK");
  });

  it("atomically approves and creates one provenance-complete dispatch-pending Run", async () => {
    const fake = pool([
      [],
      [],
      [pendingApproval],
      [
        {
          session_id: "session_44444444-4444-4444-4444-444444444444",
          binding_id: "binding_55555555-5555-5555-5555-555555555555",
          adapter_kind: "OPENCLAW",
          route_id: "route_99999999-9999-9999-9999-999999999999",
        },
      ],
      [],
      [],
      [{ last_sequence: "8" }],
      [],
      [{ last_sequence: "9" }],
      [],
      [],
      [],
    ]);
    const eventIds = [
      "event_66666666-6666-6666-6666-666666666666",
      "event_77777777-7777-7777-7777-777777777777",
    ];
    const result = await new PostgresApprovalRunStore(fake.value, {
      eventId: () => eventIds.shift() ?? "invalid",
      selectRoute: async () =>
        ResourceBrokerDecisionSchema.parse({
          schemaVersion: 1,
          policy: {
            version: "resource-broker-v1",
            weights: {
              quality: 0.4,
              remainingLimits: 0.3,
              cost: 0.1,
              speed: 0.1,
              load: 0.1,
            },
          },
          decidedAt: "2026-08-13T10:05:00.000Z",
          evaluations: [],
          selected: {
            routeId: "route_99999999-9999-9999-9999-999999999999",
            mode: "WORK",
            adapterKind: "OPENCLAW",
            isAvailable: true,
            quality: 1,
            remainingLimits: 1,
            cost: 1,
            speed: 1,
            load: 1,
            observedAt: "2026-08-13T10:04:00.000Z",
            expiresAt: "2026-08-13T10:06:00.000Z",
          },
        }),
    }).decide({
      taskId,
      approvalId,
      decision: "APPROVE",
      commandId: "approval-decision:approve:11111111-1111-1111-1111-111111111111",
      decidedAt: "2026-08-13T10:05:00.000Z",
    });

    expect(result.outcome).toBe("DECIDED");
    expect(result.approval.type).toBe("APPROVED");
    expect(result.run).toMatchObject({
      id: runId,
      taskId,
      approvalId,
      status: "DISPATCH_PENDING",
      attempt: 0,
      dispatchIdempotencyKey: "run:11111111-1111-1111-1111-111111111111",
    });
    expect(fake.query.mock.calls.map(([sql]) => String(sql))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("UPDATE agent_world.approvals"),
        expect.stringContaining("INSERT INTO agent_world.runs"),
        expect.stringContaining("'APPROVAL_STATE_CHANGED'"),
        expect.stringContaining("'AGENT_STATUS_CHANGED'"),
        expect.stringContaining("INSERT INTO agent_world.world_agent_status"),
      ]),
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
    expect(fake.release).toHaveBeenCalledOnce();
    const activeSessionQuery = fake.query.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes("FROM agent_world.conversation_sessions"));
    expect(activeSessionQuery).toContain("s.adapter_kind IN ('OPENCLAW', 'CODEX')");
    expect(activeSessionQuery).not.toContain("s.adapter_kind = 'OPENCLAW'");
  });

  it("atomically creates a queued Native Chat dispatch without a runtime session", async () => {
    const fake = pool([
      [],
      [],
      [pendingApproval],
      [],
      [],
      [],
      [{ last_sequence: "8" }],
      [],
      [{ last_sequence: "9" }],
      [],
      [],
      [],
    ]);
    const eventIds = [
      "event_66666666-6666-6666-6666-666666666666",
      "event_77777777-7777-7777-7777-777777777777",
    ];
    const result = await new PostgresApprovalRunStore(fake.value, {
      eventId: () => eventIds.shift() ?? "invalid",
      selectRoute: async () =>
        ResourceBrokerDecisionSchema.parse({
          schemaVersion: 1,
          policy: {
            version: "resource-broker-v1",
            weights: {
              quality: 0.4,
              remainingLimits: 0.3,
              cost: 0.1,
              speed: 0.1,
              load: 0.1,
            },
          },
          decidedAt: "2026-08-13T10:05:00.000Z",
          evaluations: [],
          selected: {
            routeId: "route_99999999-9999-9999-9999-999999999999",
            accountId: "account_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            mode: "CHAT",
            adapterKind: "NATIVE_CHATGPT",
            isAvailable: true,
            quality: 1,
            remainingLimits: 1,
            cost: 1,
            speed: 1,
            load: 1,
            observedAt: "2026-08-13T10:04:00.000Z",
            expiresAt: "2026-08-13T10:06:00.000Z",
          },
        }),
    }).decide({
      taskId,
      approvalId,
      decision: "APPROVE",
      commandId: "approval-decision:approve:11111111-1111-1111-1111-111111111111",
      decidedAt: "2026-08-13T10:05:00.000Z",
    });

    expect(result.run).toMatchObject({
      adapterKind: "NATIVE_CHATGPT",
      routeId: "route_99999999-9999-9999-9999-999999999999",
      accountId: "account_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      executionMode: "CHAT",
    });
    expect(result.run).not.toHaveProperty("bindingId");
    expect(result.run).not.toHaveProperty("sessionId");
    const statements = fake.query.mock.calls.map(([sql]) => String(sql));
    expect(
      statements.some((sql) => sql.includes("INSERT INTO agent_world.native_chat_dispatches")),
    ).toBe(true);
    expect(statements.some((sql) => sql.includes("FROM agent_world.conversation_sessions"))).toBe(
      false,
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("denies without creating a Run or claiming runtime status", async () => {
    const fake = pool([[], [], [pendingApproval], [], [{ last_sequence: "8" }], [], []]);
    const result = await new PostgresApprovalRunStore(fake.value, {
      eventId: () => "event_88888888-8888-8888-8888-888888888888",
    }).decide({
      taskId,
      approvalId,
      decision: "DENY",
      reason: "The requested operation is too broad.",
      commandId: "approval-decision:deny:11111111-1111-1111-1111-111111111111",
      decidedAt: "2026-08-13T10:05:00.000Z",
    });

    expect(result).toMatchObject({ outcome: "DECIDED", approval: { type: "DENIED" } });
    expect(result.run).toBeUndefined();
    expect(
      fake.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO agent_world.runs")),
    ).toBe(false);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("world_agent_status"))).toBe(
      false,
    );
  });

  it("fails closed after expiration", async () => {
    const fake = pool([[], [], [pendingApproval], []]);
    const store = new PostgresApprovalRunStore(fake.value);
    await expect(
      store.decide({
        taskId,
        approvalId,
        decision: "APPROVE",
        commandId: "approval-decision:late:11111111-1111-1111-1111-111111111111",
        decidedAt: "2026-08-13T10:15:00.000Z",
      }),
    ).rejects.toEqual(new ApprovalRunStoreError("APPROVAL_EXPIRED"));
    expect(fake.query).toHaveBeenLastCalledWith("ROLLBACK");
  });

  it("replays the same decision command without creating another Run", async () => {
    const approved = {
      ...pendingApproval,
      state: "APPROVED",
      decided_at: "2026-08-13T10:05:00.000Z",
      decision_command_id: "approval-decision:approve:11111111-1111-1111-1111-111111111111",
    };
    const run = {
      id: runId,
      task_id: taskId,
      agent_id: agentId,
      approval_id: approvalId,
      adapter_kind: "OPENCLAW",
      binding_id: "binding_55555555-5555-5555-5555-555555555555",
      session_id: "session_44444444-4444-4444-4444-444444444444",
      status: "DISPATCH_PENDING",
      attempt: 0,
      dispatch_idempotency_key: "run:11111111-1111-1111-1111-111111111111",
      external_run_id: null,
      created_at: "2026-08-13T10:05:00.000Z",
      started_at: null,
      completed_at: null,
      failure_code: null,
    };
    const fake = pool([[], [], [approved], [run], []]);
    const result = await new PostgresApprovalRunStore(fake.value).decide({
      taskId,
      approvalId,
      decision: "APPROVE",
      commandId: approved.decision_command_id,
      decidedAt: approved.decided_at,
    });
    expect(result).toMatchObject({ outcome: "REPLAY", run: { id: runId } });
    expect(fake.query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE"))).toBe(false);
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("revokes only a not-yet-dispatched Run and cancels it atomically", async () => {
    const approved = {
      ...pendingApproval,
      state: "APPROVED",
      decided_at: "2026-08-13T10:05:00.000Z",
      decision_command_id: "approval-decision:approve:11111111-1111-1111-1111-111111111111",
    };
    const pendingRun = {
      id: runId,
      task_id: taskId,
      agent_id: agentId,
      approval_id: approvalId,
      adapter_kind: "OPENCLAW",
      binding_id: "binding_55555555-5555-5555-5555-555555555555",
      session_id: "session_44444444-4444-4444-4444-444444444444",
      status: "DISPATCH_PENDING",
      attempt: 0,
      dispatch_idempotency_key: "run:11111111-1111-1111-1111-111111111111",
      external_run_id: null,
      created_at: "2026-08-13T10:05:00.000Z",
      started_at: null,
      completed_at: null,
      failure_code: null,
    };
    const fake = pool([
      [],
      [],
      [approved],
      [pendingRun],
      [],
      [],
      [{ last_sequence: "10" }],
      [],
      [{ last_sequence: "11" }],
      [],
      [],
      [],
    ]);
    const eventIds = [
      "event_99999999-9999-9999-9999-999999999999",
      "event_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    ];
    const result = await new PostgresApprovalRunStore(fake.value, {
      eventId: () => eventIds.shift() ?? "invalid",
    }).decide({
      taskId,
      approvalId,
      decision: "REVOKE",
      reason: "Owner withdrew authorization before dispatch.",
      commandId: "approval-decision:revoke:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      decidedAt: "2026-08-13T10:06:00.000Z",
    });
    expect(result).toMatchObject({
      outcome: "DECIDED",
      approval: { type: "REVOKED" },
      run: { status: "CANCELLED", completedAt: "2026-08-13T10:06:00.000Z" },
    });
    expect(fake.query.mock.calls.map(([sql]) => String(sql))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("SET state = 'REVOKED'"),
        expect.stringContaining("SET status = 'CANCELLED'"),
      ]),
    );
  });

  it("revocation removes a pending Native Chat dispatch from the launcher queue", async () => {
    const approved = {
      ...pendingApproval,
      state: "APPROVED",
      decided_at: "2026-08-13T10:05:00.000Z",
      decision_command_id: "approval-decision:approve:11111111-1111-1111-1111-111111111111",
    };
    const pendingNativeRun = {
      id: runId,
      task_id: taskId,
      agent_id: agentId,
      approval_id: approvalId,
      adapter_kind: "NATIVE_CHATGPT",
      binding_id: null,
      session_id: null,
      route_id: "route_99999999-9999-9999-9999-999999999999",
      account_id: "account_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      execution_mode: "CHAT",
      status: "DISPATCH_PENDING",
      attempt: 0,
      dispatch_idempotency_key: "run:11111111-1111-1111-1111-111111111111",
      external_run_id: null,
      created_at: "2026-08-13T10:05:00.000Z",
      started_at: null,
      completed_at: null,
      failure_code: null,
    };
    const fake = pool([
      [],
      [],
      [approved],
      [pendingNativeRun],
      [],
      [],
      [],
      [{ last_sequence: "10" }],
      [],
      [{ last_sequence: "11" }],
      [],
      [],
      [],
    ]);
    const eventIds = [
      "event_99999999-9999-9999-9999-999999999999",
      "event_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    ];
    const result = await new PostgresApprovalRunStore(fake.value, {
      eventId: () => eventIds.shift() ?? "invalid",
    }).decide({
      taskId,
      approvalId,
      decision: "REVOKE",
      reason: "Owner withdrew Native Chat authorization before launch.",
      commandId: "approval-decision:revoke:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      decidedAt: "2026-08-13T10:06:00.000Z",
    });

    expect(result.run).toMatchObject({ adapterKind: "NATIVE_CHATGPT", status: "CANCELLED" });
    expect(
      fake.query.mock.calls.some(
        ([sql]) =>
          String(sql).includes("UPDATE agent_world.native_chat_dispatches") &&
          String(sql).includes("APPROVAL_REVOKED"),
      ),
    ).toBe(true);
  });
});
