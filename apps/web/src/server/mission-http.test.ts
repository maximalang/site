import { MissionSchema } from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import { createMissionRouteHandler } from "./mission-http";

const mission = MissionSchema.parse({
  schemaVersion: 1,
  id: "mission_11111111-1111-1111-1111-111111111111",
  projectId: "project_11111111-1111-1111-1111-111111111111",
  title: "Ship the control center",
  goal: "Complete the remaining acceptance gates.",
  status: "ACTIVE",
  executionPolicy: "REVIEW_EACH_TASK",
  successCriteria: [
    {
      id: "mission_criterion_11111111-1111-1111-1111-111111111111",
      statement: "All gates pass",
      verification: "TEST",
      status: "PENDING",
      evidenceRefs: [],
    },
  ],
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
});

describe("createMissionRouteHandler", () => {
  it("persists one owner-authorized canonical Mission", async () => {
    const create = vi.fn().mockResolvedValue({ outcome: "CREATED", mission });
    const response = await createMissionRouteHandler({ authorize: async () => true, create })(
      new Request("https://world.test/api/missions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://world.test" },
        body: JSON.stringify(mission),
      }),
    );
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(mission);
    expect(await response.json()).toEqual({ schemaVersion: 1, outcome: "CREATED", mission });
  });

  it("rejects cross-origin Mission commands", async () => {
    const response = await createMissionRouteHandler({
      authorize: async () => true,
      create: vi.fn(),
    })(
      new Request("https://world.test/api/missions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.test" },
        body: JSON.stringify(mission),
      }),
    );
    expect(response.status).toBe(400);
  });
});
