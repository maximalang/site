import { describe, expect, it } from "vitest";
import { AgentScheduleSchema } from "./schedule.js";

const schedule = {
  schemaVersion: 1,
  id: "schedule_11111111-1111-1111-1111-111111111111",
  projectId: "project_22222222-2222-2222-2222-222222222222",
  agentId: "agent_33333333-3333-3333-3333-333333333333",
  missionId: "mission_44444444-4444-4444-4444-444444444444",
  title: "Daily project review",
  taskDescription: "Review new evidence and propose next actions.",
  cronExpression: "0 9 * * *",
  timezone: "Europe/Moscow",
  isEnabled: true,
  nextFireAt: "2026-08-16T06:00:00.000Z",
  createdAt: "2026-08-15T10:00:00.000Z",
  updatedAt: "2026-08-15T10:00:00.000Z",
};

describe("AgentSchedule", () => {
  it("keeps Agent, Account and Mission identities distinct", () => {
    const parsed = AgentScheduleSchema.parse(schedule);
    expect(parsed.agentId).toBe(schedule.agentId);
    expect(JSON.stringify(parsed)).not.toContain("account");
    expect(() => AgentScheduleSchema.parse({ ...schedule, accountId: "account_forged" })).toThrow();
  });

  it("requires the next fire time to follow creation for enabled schedules", () => {
    expect(() =>
      AgentScheduleSchema.parse({ ...schedule, nextFireAt: "2026-08-15T09:59:59.000Z" }),
    ).toThrow(/next fire/i);
    expect(() =>
      AgentScheduleSchema.parse({ ...schedule, isEnabled: false, nextFireAt: undefined }),
    ).not.toThrow();
  });
});
