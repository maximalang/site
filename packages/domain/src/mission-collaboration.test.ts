import { describe, expect, it } from "vitest";
import { MissionDecompositionSchema, StructuredMeetingSchema } from "./mission.js";

const ids = {
  mission: "mission_11111111-1111-1111-1111-111111111111",
  decomposition: "mission_decomposition_22222222-2222-2222-2222-222222222222",
  meeting: "structured_meeting_33333333-3333-3333-3333-333333333333",
  project: "project_44444444-4444-4444-4444-444444444444",
  agentA: "agent_55555555-5555-5555-5555-555555555555",
  agentB: "agent_66666666-6666-6666-6666-666666666666",
  event: "event_77777777-7777-7777-7777-777777777777",
};

describe("Mission collaboration contracts", () => {
  it("accepts a bounded dependency-aware decomposition without Account identity", () => {
    const decomposition = MissionDecompositionSchema.parse({
      schemaVersion: 1,
      id: ids.decomposition,
      missionId: ids.mission,
      projectId: ids.project,
      sourceEventId: ids.event,
      rationale: "Split implementation from review.",
      tasks: [
        {
          key: "implement",
          title: "Implement the change",
          description: "Produce the canonical implementation.",
          assigneeAgentId: ids.agentA,
          dependsOn: [],
        },
        {
          key: "review",
          title: "Review the change",
          description: "Verify the implementation against success criteria.",
          assigneeAgentId: ids.agentB,
          dependsOn: ["implement"],
        },
      ],
      createdAt: "2026-08-15T10:00:00.000Z",
    });

    expect(JSON.stringify(decomposition)).not.toContain("account");
    expect(decomposition.tasks[1]?.dependsOn).toEqual(["implement"]);
  });

  it("rejects dependency cycles and free-form meeting transcripts", () => {
    expect(() =>
      MissionDecompositionSchema.parse({
        schemaVersion: 1,
        id: ids.decomposition,
        missionId: ids.mission,
        projectId: ids.project,
        sourceEventId: ids.event,
        rationale: "Invalid cycle.",
        tasks: [
          { key: "a", title: "A", assigneeAgentId: ids.agentA, dependsOn: ["b"] },
          { key: "b", title: "B", assigneeAgentId: ids.agentB, dependsOn: ["a"] },
        ],
        createdAt: "2026-08-15T10:00:00.000Z",
      }),
    ).toThrow(/cycle/i);

    expect(() =>
      StructuredMeetingSchema.parse({
        schemaVersion: 1,
        id: ids.meeting,
        missionId: ids.mission,
        projectId: ids.project,
        topic: "Choose the release strategy",
        positions: [
          { agentId: ids.agentA, position: "Ship now.", evidenceRefs: [] },
          { agentId: ids.agentB, position: "Review first.", evidenceRefs: [] },
        ],
        transcript: ["Agent A said..."],
        synthesis: "Review first, then ship.",
        decision: "Run the production gate before release.",
        sourceEventIds: [ids.event],
        decidedAt: "2026-08-15T10:05:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects a meeting decision without canonical source Events", () => {
    expect(() =>
      StructuredMeetingSchema.parse({
        schemaVersion: 1,
        id: ids.meeting,
        missionId: ids.mission,
        projectId: ids.project,
        topic: "Choose the release strategy",
        positions: [
          { agentId: ids.agentA, position: "Ship now.", evidenceRefs: [] },
          { agentId: ids.agentB, position: "Review first.", evidenceRefs: [] },
        ],
        synthesis: "Review first, then ship.",
        decision: "Run the production gate before release.",
        sourceEventIds: [],
        decidedAt: "2026-08-15T10:05:00.000Z",
      }),
    ).toThrow(/source Events/i);
  });
});
