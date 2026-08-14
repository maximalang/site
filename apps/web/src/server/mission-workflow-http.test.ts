import { describe, expect, it, vi } from "vitest";
import { createMissionWorkflowRouteHandler } from "./mission-workflow-http";

const missionId = "mission_11111111-1111-1111-1111-111111111111";

function request(body: unknown, origin = "https://world.test") {
  return new Request(`${origin}/api/missions/workflow`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("Mission workflow HTTP", () => {
  it("advances an authenticated canonical Mission without accepting workflow state", async () => {
    const advance = vi.fn(async () => ({
      schemaVersion: 1,
      missionId,
      taskIds: [],
      runIds: [],
      completedTaskIds: [],
      failedTaskIds: [],
      phase: "PLANNING",
      retryCount: 0,
      maxRetries: 2,
      reviewRequired: true,
      pendingAction: "DECOMPOSE_MISSION",
    }));
    const handler = createMissionWorkflowRouteHandler({
      authorize: async () => true,
      advance,
    });

    const response = await handler(request({ missionId }));

    expect(response.status).toBe(200);
    expect(advance).toHaveBeenCalledWith(missionId);
    expect(await response.json()).toMatchObject({ pendingAction: "DECOMPOSE_MISSION" });
  });

  it("fails closed for forged state, cross-origin requests and unavailable storage", async () => {
    const advance = vi.fn(async () => {
      throw new Error("unavailable");
    });
    const handler = createMissionWorkflowRouteHandler({
      authorize: async () => true,
      advance,
    });

    expect((await handler(request({ missionId, phase: "COMPLETED" }))).status).toBe(400);
    expect(
      (
        await handler(
          new Request("https://world.test/api/missions/workflow", {
            method: "POST",
            headers: { "content-type": "application/json", origin: "https://evil.test" },
            body: JSON.stringify({ missionId }),
          }),
        )
      ).status,
    ).toBe(400);
    expect((await handler(request({ missionId }))).status).toBe(503);
  });
});
