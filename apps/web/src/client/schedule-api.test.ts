import { AgentScheduleSchema } from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import { type CreateScheduleInput, createSchedule, loadSchedules } from "./schedule-api";

const schedule = {
  schemaVersion: 1 as const,
  id: "schedule_77777777-7777-4777-8777-777777777777",
  projectId: "project_66666666-6666-4666-8666-666666666666",
  agentId: "agent_55555555-5555-4555-8555-555555555555",
  title: "Daily audit",
  cronExpression: "0 9 * * *",
  timezone: "Europe/Moscow",
  isEnabled: true,
  nextFireAt: "2026-08-16T06:00:00.000Z",
  createdAt: "2026-08-15T12:00:00.000Z",
  updatedAt: "2026-08-15T12:00:00.000Z",
};
const canonicalSchedule = AgentScheduleSchema.parse(schedule);

describe("schedule API client", () => {
  it("validates list responses", async () => {
    const fetcher = vi.fn(async () => Response.json({ schemaVersion: 1, schedules: [schedule] }));
    await expect(loadSchedules(fetcher)).resolves.toEqual([schedule]);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/schedules?limit=100",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("sends CSRF and unwraps a canonical created schedule", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ schemaVersion: 1, schedule: { outcome: "CREATED", schedule } }),
    );
    const input: CreateScheduleInput = {
      id: canonicalSchedule.id,
      projectId: canonicalSchedule.projectId,
      agentId: canonicalSchedule.agentId,
      title: schedule.title,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      isEnabled: true,
    };
    await expect(createSchedule(input, "csrf-token", fetcher)).resolves.toEqual(schedule);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/schedules",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-agent-world-csrf": "csrf-token" }),
      }),
    );
  });

  it("rejects malformed or failed responses", async () => {
    await expect(loadSchedules(async () => Response.json({ schedules: [] }))).rejects.toThrow(
      /invalid/i,
    );
    await expect(loadSchedules(async () => new Response(null, { status: 503 }))).rejects.toThrow(
      /unavailable/i,
    );
  });
});
