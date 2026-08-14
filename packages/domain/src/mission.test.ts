import { describe, expect, it } from "vitest";
import { AgentSchema } from "./identity.js";
import { AgentInstanceAssignmentSchema, AgentTemplateSchema, MissionSchema } from "./mission.js";

const ids = {
  mission: "mission_11111111-1111-1111-1111-111111111111",
  criterion: "mission_criterion_22222222-2222-2222-2222-222222222222",
  project: "project_33333333-3333-3333-3333-333333333333",
  template: "agent_template_44444444-4444-4444-4444-444444444444",
  agent: "agent_55555555-5555-5555-5555-555555555555",
} as const;

describe("Mission and Agent Template contracts", () => {
  it("keeps Mission success evidence and template identity separate from Agent", () => {
    expect(
      MissionSchema.parse({
        schemaVersion: 1,
        id: ids.mission,
        projectId: ids.project,
        title: "Ship AI World",
        goal: "Satisfy the production acceptance criteria.",
        status: "ACTIVE",
        successCriteria: [
          {
            id: ids.criterion,
            statement: "Runtime replay is deterministic.",
            verification: "TEST",
            status: "PENDING",
            evidenceRefs: [],
          },
        ],
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
      }),
    ).not.toHaveProperty("accountId");
    expect(
      AgentTemplateSchema.parse({
        schemaVersion: 1,
        id: ids.template,
        version: 1,
        slug: "research-lead",
        displayName: "Research Lead",
        role: "Evidence-first research",
        instructions: "Use primary sources.",
        skillIds: [],
        toolIds: [],
        createdAt: "2026-08-15T00:00:00.000Z",
      }),
    ).not.toHaveProperty("agentId");
    expect(
      AgentInstanceAssignmentSchema.parse({
        schemaVersion: 1,
        agentId: ids.agent,
        templateId: ids.template,
        templateVersion: 1,
        projectId: ids.project,
        missionId: ids.mission,
        createdAt: "2026-08-15T00:00:00.000Z",
      }),
    ).not.toHaveProperty("accountId");
  });

  it("rejects false Mission success, duplicate criteria and partial template links", () => {
    const base = {
      schemaVersion: 1 as const,
      id: ids.mission,
      projectId: ids.project,
      title: "Ship AI World",
      goal: "Satisfy acceptance.",
      status: "SUCCEEDED" as const,
      successCriteria: [
        {
          id: ids.criterion,
          statement: "Runtime replay is deterministic.",
          verification: "TEST" as const,
          status: "PENDING" as const,
          evidenceRefs: [],
        },
      ],
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    expect(MissionSchema.safeParse(base).success).toBe(false);
    expect(
      MissionSchema.safeParse({
        ...base,
        status: "ACTIVE",
        successCriteria: [base.successCriteria[0], base.successCriteria[0]],
      }).success,
    ).toBe(false);
    expect(
      AgentSchema.safeParse({
        schemaVersion: 1,
        id: ids.agent,
        slug: "research-lead",
        displayName: "Research Lead",
        role: "Evidence-first research",
        instructions: "Use primary sources.",
        templateId: ids.template,
        isEnabled: true,
      }).success,
    ).toBe(false);
  });
});
