import { describe, expect, it, vi } from "vitest";
import { createMissionCollaborationRouteHandler } from "./mission-collaboration-http";

const decomposition = {
  schemaVersion: 1,
  id: "mission_decomposition_11111111-1111-1111-1111-111111111111",
  missionId: "mission_22222222-2222-2222-2222-222222222222",
  projectId: "project_33333333-3333-3333-3333-333333333333",
  sourceEventId: "event_44444444-4444-4444-4444-444444444444",
  rationale: "Implement, then review.",
  tasks: [
    {
      taskId: "task_55555555-5555-5555-5555-555555555555",
      key: "implement",
      title: "Implement",
      assigneeAgentId: "agent_66666666-6666-6666-6666-666666666666",
      dependsOn: [],
    },
  ],
  createdAt: "2026-08-15T10:00:00.000Z",
};

function request(body: unknown) {
  return new Request("https://world.test/api/missions/collaboration", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://world.test" },
    body: JSON.stringify(body),
  });
}

describe("Mission collaboration HTTP", () => {
  it("validates and materializes a bounded decomposition", async () => {
    const createDecomposition = vi.fn(async () => ({ materialization: { outcome: "CREATED" } }));
    const handler = createMissionCollaborationRouteHandler({
      authorize: async () => true,
      createDecomposition,
      recordMeeting: vi.fn(),
      now: () => new Date("2026-08-15T10:01:00.000Z"),
    });

    const response = await handler(request({ operation: "DECOMPOSE", decomposition }));

    expect(response.status).toBe(200);
    expect(createDecomposition).toHaveBeenCalledWith(
      expect.objectContaining({ id: decomposition.id }),
      "2026-08-15T10:01:00.000Z",
    );
  });

  it("rejects Account identity injection and fails closed on storage conflict", async () => {
    const createDecomposition = vi.fn(async () => {
      throw new Error("conflict");
    });
    const handler = createMissionCollaborationRouteHandler({
      authorize: async () => true,
      createDecomposition,
      recordMeeting: vi.fn(),
    });

    expect(
      (
        await handler(
          request({
            operation: "DECOMPOSE",
            decomposition: { ...decomposition, accountId: "account_forged" },
          }),
        )
      ).status,
    ).toBe(400);
    expect((await handler(request({ operation: "DECOMPOSE", decomposition }))).status).toBe(409);
  });
});
