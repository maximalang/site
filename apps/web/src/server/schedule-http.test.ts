import { describe, expect, it, vi } from "vitest";
import { createScheduleRouteHandlers } from "./schedule-http";

const valid = {
  id: "schedule_00000000-0000-4000-8000-000000000001",
  projectId: "project_00000000-0000-4000-8000-000000000001",
  agentId: "agent_00000000-0000-4000-8000-000000000001",
  title: "Daily research",
  cronExpression: "0 9 * * *",
  timezone: "Europe/Moscow",
  isEnabled: true,
};

function request(method: string, body?: unknown) {
  return new Request("https://world.example/api/schedules", {
    method,
    headers: { "content-type": "application/json", origin: "https://world.example" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("schedule HTTP", () => {
  it("creates an owner-authorized strict Agent schedule", async () => {
    const create = vi.fn(async () => ({ outcome: "CREATED" }));
    const handlers = createScheduleRouteHandlers({
      authorize: async () => true,
      list: async () => [],
      create,
      now: () => new Date("2026-08-15T12:00:00.000Z"),
    });
    const response = await handlers.POST(request("POST", valid));
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(valid, "2026-08-15T12:00:00.000Z");
  });

  it("rejects Account coupling, cross-origin mutation and unauthorized reads", async () => {
    const dependencies = {
      authorize: async () => true,
      list: vi.fn(async () => []),
      create: vi.fn(),
    };
    const handlers = createScheduleRouteHandlers(dependencies);
    expect(
      (await handlers.POST(request("POST", { ...valid, accountId: "account_x" }))).status,
    ).toBe(400);
    const crossOrigin = new Request("https://world.example/api/schedules", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify(valid),
    });
    expect((await handlers.POST(crossOrigin)).status).toBe(400);
    const unauthorized = createScheduleRouteHandlers({
      ...dependencies,
      authorize: async () => false,
    });
    expect((await unauthorized.GET(request("GET"))).status).toBe(401);
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it("lists bounded schedules and fails closed on provider errors", async () => {
    const list = vi.fn(async () => [valid]);
    const handlers = createScheduleRouteHandlers({
      authorize: async () => true,
      list,
      create: vi.fn(),
    });
    expect(
      (await handlers.GET(new Request("https://world.example/api/schedules?limit=25"))).status,
    ).toBe(200);
    expect(list).toHaveBeenCalledWith(25);
    const failed = createScheduleRouteHandlers({
      authorize: async () => true,
      list: async () => {
        throw new Error("db");
      },
      create: vi.fn(),
    });
    expect((await failed.GET(request("GET"))).status).toBe(503);
  });
});
