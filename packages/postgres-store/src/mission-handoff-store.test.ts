import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import { PostgresMissionHandoffStore } from "./mission-handoff-store.js";

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

describe("PostgresMissionHandoffStore", () => {
  it("activates one dependency-complete handoff with provenance and a renewed approval window", async () => {
    const fake = pool([
      [],
      [
        {
          task_id: "task_22222222-2222-4222-8222-222222222222",
          mission_id: "mission_33333333-3333-4333-8333-333333333333",
          agent_id: "agent_44444444-4444-4444-8444-444444444444",
          approval_id: "approval_22222222-2222-4222-8222-222222222222",
        },
      ],
      [
        {
          depends_on_task_id: "task_11111111-1111-4111-8111-111111111111",
          run_id: "run_11111111-1111-4111-8111-111111111111",
        },
      ],
      [],
      [],
      [],
      [{ last_sequence: "41" }],
      [],
      [],
    ]);
    const ids = [
      "event_55555555-5555-4555-8555-555555555555",
      "event_66666666-6666-4666-8666-666666666666",
    ];
    const result = await new PostgresMissionHandoffStore(fake.value, {
      eventId: () => ids.shift() ?? "invalid",
    }).activateReady("2026-08-15T12:00:00.000Z", 10);
    expect(result).toEqual([
      {
        taskId: "task_22222222-2222-4222-8222-222222222222",
        approvalId: "approval_22222222-2222-4222-8222-222222222222",
        predecessorRunIds: ["run_11111111-1111-4111-8111-111111111111"],
      },
    ]);
    const statements = fake.query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toEqual(
      expect.arrayContaining([
        expect.stringContaining("INSERT INTO agent_world.mission_handoff_activations"),
        expect.stringContaining("INSERT INTO agent_world.mission_handoffs"),
        expect.stringContaining("UPDATE agent_world.approvals"),
        expect.stringContaining("'APPROVAL_STATE_CHANGED'"),
      ]),
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("is a no-op when no downstream Task is dependency-complete", async () => {
    const fake = pool([[], [], []]);
    await expect(
      new PostgresMissionHandoffStore(fake.value, { eventId: () => "invalid" }).activateReady(
        "2026-08-15T12:00:00.000Z",
        25,
      ),
    ).resolves.toEqual([]);
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("selects only durable policy-authorized handoffs for repeatable approval", async () => {
    const fake = pool([
      [
        {
          task_id: "task_22222222-2222-4222-8222-222222222222",
          mission_id: "mission_33333333-3333-4333-8333-333333333333",
          approval_id: "approval_22222222-2222-4222-8222-222222222222",
        },
      ],
    ]);
    await expect(
      new PostgresMissionHandoffStore(fake.value, {
        eventId: () => "invalid",
      }).listPolicyAuthorized(10),
    ).resolves.toEqual([
      {
        taskId: "task_22222222-2222-4222-8222-222222222222",
        missionId: "mission_33333333-3333-4333-8333-333333333333",
        approvalId: "approval_22222222-2222-4222-8222-222222222222",
      },
    ]);
    expect(String(fake.query.mock.calls[0]?.[0])).toContain("AUTO_SAFE_HANDOFF");
    expect(fake.release).toHaveBeenCalledOnce();
  });
});
