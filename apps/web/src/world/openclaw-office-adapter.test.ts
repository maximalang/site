import { projectWorldView } from "@agent-world/read-model";
import { describe, expect, it } from "vitest";
import { buildContractFixture } from "../test-fixtures";
import {
  createOfficePresentation,
  DEFAULT_OFFICE_SKIN,
  type OfficeSkin,
} from "./openclaw-office-adapter";

describe("OpenClaw Office presentation adapter", () => {
  it("maps only canonical World agents into deterministic renderer state", () => {
    const world = projectWorldView(buildContractFixture());
    const first = createOfficePresentation(world, DEFAULT_OFFICE_SKIN);
    const second = createOfficePresentation(
      { ...world, agents: [...world.agents].reverse() },
      DEFAULT_OFFICE_SKIN,
    );

    expect(first).toEqual(second);
    expect(first.cursor).toEqual(world.cursor);
    expect(first.agents.map((agent) => agent.agentId)).toEqual(
      [...world.agents].map((agent) => agent.core.agentId).sort(),
    );
    expect(first.agents.every((agent) => agent.x > 0 && agent.y > 0)).toBe(true);
    expect(first.agents[0]).not.toHaveProperty("accountId");
    expect(first.agents[0]).not.toHaveProperty("sessionId");
    expect(first.agents[0]).not.toHaveProperty("externalAgentId");
  });

  it("maps real status to one of four compact presentation zones", () => {
    const world = projectWorldView(buildContractFixture());
    const fixtureAgent = world.agents[0];
    expect(fixtureAgent).toBeDefined();
    if (!fixtureAgent) return;

    const cases = [
      ["IDLE", "IDLE", "COMMONS", "NONE"],
      ["OFFLINE", "OFFLINE", "COMMONS", "NONE"],
      ["QUEUED", "QUEUED", "FOCUS", "NONE"],
      ["RUNNING", "WORKING", "FOCUS", "WORK"],
      ["WAITING_APPROVAL", "REVIEWING", "REVIEW_OPS", "REVIEW"],
      ["BLOCKED", "BLOCKED", "REVIEW_OPS", "NONE"],
      ["FAILED", "ERROR", "REVIEW_OPS", "NONE"],
    ] as const;

    for (const [status, visualStatus, zone, actionCue] of cases) {
      const presentation = createOfficePresentation(
        { ...world, agents: [{ ...fixtureAgent, core: { ...fixtureAgent.core, status } }] },
        DEFAULT_OFFICE_SKIN,
      );
      expect(presentation.agents[0]).toEqual(
        expect.objectContaining({ visualStatus, zone, actionCue }),
      );
    }

    expect(DEFAULT_OFFICE_SKIN.zones).toHaveLength(4);
  });

  it("allows a map skin change without changing canonical or semantic state", () => {
    const world = projectWorldView(buildContractFixture());
    const roomySkin: OfficeSkin = {
      ...DEFAULT_OFFICE_SKIN,
      id: "roomy-test",
      width: 1_600,
      height: 900,
      zones: DEFAULT_OFFICE_SKIN.zones.map((zone) => ({
        ...zone,
        x: zone.x * 1.25,
        y: zone.y * 1.2,
      })),
    };

    const defaultView = createOfficePresentation(world, DEFAULT_OFFICE_SKIN);
    const roomyView = createOfficePresentation(world, roomySkin);

    expect(roomyView.skinId).toBe("roomy-test");
    expect(
      roomyView.agents.map(({ agentId, visualStatus, actionCue, zone }) => ({
        agentId,
        visualStatus,
        actionCue,
        zone,
      })),
    ).toEqual(
      defaultView.agents.map(({ agentId, visualStatus, actionCue, zone }) => ({
        agentId,
        visualStatus,
        actionCue,
        zone,
      })),
    );
    expect(roomyView.agents.map(({ x, y }) => ({ x, y }))).not.toEqual(
      defaultView.agents.map(({ x, y }) => ({ x, y })),
    );
  });

  it("rejects duplicate canonical Agent identities", () => {
    const world = projectWorldView(buildContractFixture());
    const agent = world.agents[0];
    expect(agent).toBeDefined();
    if (!agent) return;

    expect(() =>
      createOfficePresentation({ ...world, agents: [agent, agent] }, DEFAULT_OFFICE_SKIN),
    ).toThrow(/duplicate canonical agent/i);
  });
});
