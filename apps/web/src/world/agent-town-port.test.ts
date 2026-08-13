import { projectWorldView } from "@agent-world/read-model";
import { describe, expect, it } from "vitest";
import { buildContractFixture } from "../test-fixtures";
import { getWorldAgentAt, layoutWorldAgents } from "./agent-town-port";

describe("Agent Town renderer port", () => {
  it("places the same canonical projection deterministically inside semantic rooms", () => {
    const agents = projectWorldView(buildContractFixture()).agents;
    const first = layoutWorldAgents(1_000, 620, agents);
    const second = layoutWorldAgents(1_000, 620, agents);

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first.every((agent) => agent.x > 0 && agent.x < 1_000)).toBe(true);
    expect(first.every((agent) => agent.y > 0 && agent.y < 620)).toBe(true);
    expect(new Set(first.map((agent) => agent.zone))).toEqual(new Set(["WORK_ROOM", "AGENT_HALL"]));
  });

  it("hit-tests only the canonical Agent marker at a pointer position", () => {
    const agents = projectWorldView(buildContractFixture()).agents;
    const layout = layoutWorldAgents(1_000, 620, agents);
    const target = layout[0];
    expect(target).toBeDefined();

    expect(getWorldAgentAt(target?.x ?? 0, target?.y ?? 0, layout)?.agentId).toBe(target?.agentId);
    expect(getWorldAgentAt(-100, -100, layout)).toBeNull();
  });
});
