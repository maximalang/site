import type { AgentProjectionCore, WorldHandoff } from "@agent-world/read-model";
import { describe, expect, it } from "vitest";
import {
  advancePosition,
  clampCamera,
  clampZoom,
  fitWorldCamera,
  initialCameraForAgents,
  spriteIdentity,
  statusTargetZone,
  statusVisual,
  targetForAgent,
  WORLD_SIZE,
} from "./world-presentation";

const agent: AgentProjectionCore = {
  agentId: "agent_11111111-1111-1111-1111-111111111111" as AgentProjectionCore["agentId"],
  displayName: "Research Lead",
  role: "Research",
  isEnabled: true,
  status: "IDLE",
};
const handoff: WorldHandoff = {
  id: "event_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" as WorldHandoff["id"],
  missionId: "mission_cccccccc-cccc-cccc-cccc-cccccccccccc" as WorldHandoff["missionId"],
  fromTaskId: "task_44444444-4444-4444-4444-444444444444" as WorldHandoff["fromTaskId"],
  toTaskId: "task_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" as WorldHandoff["toTaskId"],
  fromRunId: "run_dddddddd-dddd-dddd-dddd-dddddddddddd" as WorldHandoff["fromRunId"],
  fromAgentId: agent.agentId,
  toAgentId: "agent_22222222-2222-2222-2222-222222222222" as WorldHandoff["toAgentId"],
  occurredAt: "2026-08-13T06:00:03.500Z",
};

describe("Phase 6 World presentation model", () => {
  it("maps canonical statuses to presentation zones", () => {
    expect(statusTargetZone("IDLE")).toBe("COMMONS");
    expect(statusTargetZone("RUNNING")).toBe("WORK");
    expect(statusTargetZone("QUEUED")).toBe("WORK");
    expect(statusTargetZone("WAITING_APPROVAL")).toBe("REVIEW");
    expect(statusTargetZone("BLOCKED")).toBe("OPERATIONS");
    expect(statusTargetZone("FAILED")).toBe("OPERATIONS");
    expect(statusTargetZone("OFFLINE")).toBe("COMMONS");
  });

  it("derives stable differentiated sprite identities", () => {
    const first = spriteIdentity(agent.agentId);
    expect(spriteIdentity(agent.agentId)).toEqual(first);
    expect(spriteIdentity("agent_22222222-2222-2222-2222-222222222222")).not.toEqual(first);
  });

  it("maps state to working, waiting, blocked and offline visual treatments", () => {
    expect(statusVisual("RUNNING").state).toBe("working");
    expect(statusVisual("WAITING_APPROVAL").state).toBe("waiting");
    expect(statusVisual("FAILED").state).toBe("blocked");
    expect(statusVisual("OFFLINE")).toMatchObject({ state: "offline", opacity: 0.46 });
  });

  it("uses the collaboration point only when replaying a supplied canonical handoff", () => {
    const normal = targetForAgent({ ...agent, status: "RUNNING" }, 0);
    const replay = targetForAgent({ ...agent, status: "RUNNING" }, 0, handoff);
    expect(replay).not.toEqual(normal);
    expect(replay.x).toBeLessThan(786);
    expect(replay.y).toBe(506);
  });

  it("suppresses ambient interpolation for reduced motion", () => {
    expect(advancePosition({ x: 0, y: 0 }, { x: 100, y: 50 }, 16, true)).toEqual({
      point: { x: 100, y: 50 },
      moving: false,
    });
    expect(advancePosition({ x: 0, y: 0 }, { x: 100, y: 0 }, 16, false).moving).toBe(true);
  });

  it("clamps zoom and camera bounds", () => {
    expect(clampZoom(0.1)).toBe(0.15);
    expect(clampZoom(4)).toBe(2.4);
    const point = clampCamera({ x: -900, y: WORLD_SIZE.height + 900 }, 1, { x: 390, y: 844 });
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeLessThanOrEqual(WORLD_SIZE.height);
  });

  it.each([
    { x: 1440, y: 918 },
    { x: 1024, y: 686 },
    { x: 390, y: 770 },
    { x: 320, y: 646 },
  ])("fits the whole world inside a $x px viewport", (viewport) => {
    const camera = fitWorldCamera(viewport);
    expect(WORLD_SIZE.width * camera.zoom).toBeLessThanOrEqual(viewport.x - 40 + 0.001);
    expect(WORLD_SIZE.height * camera.zoom).toBeLessThanOrEqual(viewport.y - 40 + 0.001);
    expect(camera).toMatchObject({ x: WORLD_SIZE.width / 2, y: WORLD_SIZE.height / 2 });
  });

  it("derives the initial camera deterministically from agent presentation targets", () => {
    const agents: AgentProjectionCore[] = [
      { ...agent, status: "RUNNING" },
      {
        ...agent,
        agentId: "agent_22222222-2222-2222-2222-222222222222" as AgentProjectionCore["agentId"],
        displayName: "Reviewer",
        status: "WAITING_APPROVAL",
      },
    ];
    const viewport = { x: 390, y: 770 };
    const first = initialCameraForAgents(agents, viewport);
    expect(initialCameraForAgents(agents, viewport)).toEqual(first);
    expect(first.zoom).toBeGreaterThan(fitWorldCamera(viewport).zoom);
    expect(first.x).toBeGreaterThan(0);
    expect(first.x).toBeLessThan(WORLD_SIZE.width);
    expect(first.y).toBeGreaterThan(0);
    expect(first.y).toBeLessThan(WORLD_SIZE.height);
  });
});
