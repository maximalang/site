import { AgentSchema, BindingIdSchema } from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import {
  isTaskAssignmentStoreError,
  PostgresWorldProjectionStore,
  TaskAssignmentStoreError,
} from "./world-projection-store.js";

const agent = AgentSchema.parse({
  schemaVersion: 1,
  id: "agent_11111111-1111-1111-1111-111111111111",
  slug: "researcher",
  displayName: "Researcher",
  role: "Research",
  instructions: "Verify claims.",
  isEnabled: true,
});
const bindingId = BindingIdSchema.parse("binding_22222222-2222-2222-2222-222222222222");

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

describe("PostgresWorldProjectionStore", () => {
  it("recognizes bounded assignment errors across a production bundle boundary", () => {
    expect(
      isTaskAssignmentStoreError({
        name: "TaskAssignmentStoreError",
        code: "NO_ACTIVE_SESSION",
        message: "must-not-be-reflected",
      }),
    ).toBe(true);
    expect(
      isTaskAssignmentStoreError({
        name: "TaskAssignmentStoreError",
        code: "DATABASE_SECRET",
      }),
    ).toBe(false);
    expect(isTaskAssignmentStoreError(new Error("provider-secret"))).toBe(false);
  });

  it("appends one monotonic event and projection update for a changed runtime status", async () => {
    const fake = pool([[], [], [], [{ last_sequence: "7" }], [], [], []]);
    const store = new PostgresWorldProjectionStore(fake.value, {
      eventId: () => "event_33333333-3333-3333-3333-333333333333",
    });
    await store.applyOpenClawSnapshot({
      observedAt: "2026-08-13T10:00:00.000Z",
      observationId: "runtime-start:epoch-1:sequence-4",
      statuses: [{ agentId: agent.id, bindingId, status: "RUNNING" }],
    });
    expect(fake.query.mock.calls.map(([sql]) => String(sql))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("pg_advisory_xact_lock"),
        expect.stringContaining("UPDATE agent_world.world_event_stream"),
        expect.stringContaining("INSERT INTO agent_world.world_events"),
        expect.stringContaining("INSERT INTO agent_world.world_agent_status"),
      ]),
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("does not append an event when the canonical status is unchanged", async () => {
    const fake = pool([[], [], [{ status: "IDLE" }], []]);
    await new PostgresWorldProjectionStore(fake.value).applyOpenClawSnapshot({
      observedAt: "2026-08-13T10:00:00.000Z",
      observationId: "runtime-start:epoch-1:sequence-5",
      statuses: [{ agentId: agent.id, bindingId, status: "IDLE" }],
    });
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("world_events"))).toBe(false);
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("reads a restart-safe cursor and defaults Agents without events to OFFLINE", async () => {
    const fake = pool([
      [],
      [],
      [
        {
          sequence: "1",
          id: "event_44444444-4444-4444-4444-444444444444",
          occurred_at: "2026-08-13T10:00:00.000Z",
          source_kind: "RUNTIME",
          adapter_kind: "OPENCLAW",
          binding_id: bindingId,
          external_event_id: "runtime-start:epoch-1:sequence-4",
          command_id: null,
          event_type: "AGENT_STATUS_CHANGED",
          agent_id: agent.id,
          status: "RUNNING",
          task_id: null,
        },
      ],
      [],
    ]);
    const model = await new PostgresWorldProjectionStore(fake.value).readWorld([
      agent,
      AgentSchema.parse({
        ...agent,
        id: "agent_55555555-5555-5555-5555-555555555555",
        slug: "reviewer",
      }),
    ]);
    expect(model.cursor).toEqual({
      schemaVersion: 1,
      stream: "WORLD",
      lastSequence: 1,
      lastEventId: "event_44444444-4444-4444-4444-444444444444",
    });
    expect(model.agents.map(({ status }) => status)).toEqual(["RUNNING", "OFFLINE"]);
    expect(fake.query).toHaveBeenCalledWith(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("assigns an approval-gated canonical Task through an active conversation Session", async () => {
    const fake = pool([
      [],
      [],
      [],
      [{ project_id: "project_66666666-6666-6666-6666-666666666666" }],
      [],
      [],
      [{ last_sequence: "2" }],
      [],
      [],
    ]);
    const store = new PostgresWorldProjectionStore(fake.value, {
      eventId: () => "event_77777777-7777-7777-7777-777777777777",
    });
    const task = await store.assignTask({
      taskId: "task_88888888-8888-8888-8888-888888888888",
      conversationId: "conversation_99999999-9999-9999-9999-999999999999",
      agentId: agent.id,
      title: "Verify the protocol",
      description: "Use primary sources.",
      idempotencyKey: "task:88888888-8888-8888-8888-888888888888",
      createdAt: "2026-08-13T10:01:00.000Z",
    });
    expect(task.outcome).toBe("CREATED");
    expect(task.task.approvalRequirement).toBe("REQUIRED");
    expect(fake.query.mock.calls.map(([sql]) => String(sql))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("FROM agent_world.conversations"),
        expect.stringContaining("INSERT INTO agent_world.tasks"),
        expect.stringContaining("INSERT INTO agent_world.approvals"),
        expect.stringContaining("'TASK_ASSIGNED'"),
      ]),
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("reports crossed task and idempotency identities as a conflict", async () => {
    const fake = pool([
      [],
      [],
      [
        {
          id: "task_88888888-8888-8888-8888-888888888888",
          conversation_id: "conversation_99999999-9999-9999-9999-999999999999",
          project_id: "project_66666666-6666-6666-6666-666666666666",
          assignee_agent_id: agent.id,
          title: "First task",
          description: null,
          approval_requirement: "REQUIRED",
          idempotency_key: "task:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          created_at: "2026-08-13T10:00:00.000Z",
        },
        {
          id: "task_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          conversation_id: "conversation_99999999-9999-9999-9999-999999999999",
          project_id: "project_66666666-6666-6666-6666-666666666666",
          assignee_agent_id: agent.id,
          title: "Second task",
          description: null,
          approval_requirement: "REQUIRED",
          idempotency_key: "task:88888888-8888-8888-8888-888888888888",
          created_at: "2026-08-13T10:00:00.000Z",
        },
      ],
      [],
    ]);
    const store = new PostgresWorldProjectionStore(fake.value);

    await expect(
      store.assignTask({
        taskId: "task_88888888-8888-8888-8888-888888888888",
        conversationId: "conversation_99999999-9999-9999-9999-999999999999",
        agentId: agent.id,
        title: "Verify the protocol",
        idempotencyKey: "task:88888888-8888-8888-8888-888888888888",
        createdAt: "2026-08-13T10:01:00.000Z",
      }),
    ).rejects.toEqual(new TaskAssignmentStoreError("IDEMPOTENCY_CONFLICT"));
    expect(fake.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
});
