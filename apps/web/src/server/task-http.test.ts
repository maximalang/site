import { TaskAssignmentStoreError } from "@agent-world/postgres-store";
import { describe, expect, it, vi } from "vitest";
import { createTaskRouteHandler } from "./task-http";

const body = {
  schemaVersion: 1,
  taskId: "task_11111111-1111-1111-1111-111111111111",
  conversationId: "conversation_22222222-2222-2222-2222-222222222222",
  agentId: "agent_33333333-3333-3333-3333-333333333333",
  title: "Verify protocol",
  description: "Use primary sources.",
};

function request(input = body) {
  return new Request("https://world.test/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://world.test" },
    body: JSON.stringify(input),
  });
}

describe("task assignment HTTP", () => {
  it("derives policy and idempotency fields server-side", async () => {
    const assign = vi.fn(async (input) => ({
      outcome: "CREATED",
      task: {
        schemaVersion: 1,
        id: input.taskId,
        projectId: "project_44444444-4444-4444-4444-444444444444",
        assigneeAgentId: input.agentId,
        title: input.title,
        description: input.description,
        approvalRequirement: "REQUIRED",
        idempotencyKey: input.idempotencyKey,
        createdAt: input.createdAt,
      },
    }));
    const response = await createTaskRouteHandler({
      authorize: async () => true,
      assign,
      now: () => new Date("2026-08-13T12:00:00.000Z"),
    })(request());
    expect(response.status).toBe(201);
    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "task:11111111-1111-1111-1111-111111111111",
        createdAt: "2026-08-13T12:00:00.000Z",
      }),
    );
    expect(await response.json()).toEqual(
      expect.objectContaining({
        outcome: "CREATED",
        task: expect.objectContaining({ approvalRequirement: "REQUIRED" }),
      }),
    );
  });

  it("fails closed for unauthorized, malformed, conflict, and unavailable requests", async () => {
    const unauthorized = await createTaskRouteHandler({
      authorize: async () => false,
      assign: vi.fn(),
    })(request());
    expect(unauthorized.status).toBe(401);
    const malformed = await createTaskRouteHandler({
      authorize: async () => true,
      assign: vi.fn(),
    })(request({ ...body, title: "" }));
    expect(malformed.status).toBe(400);
    const conflict = await createTaskRouteHandler({
      authorize: async () => true,
      assign: async () => {
        throw new TaskAssignmentStoreError("IDEMPOTENCY_CONFLICT");
      },
    })(request());
    expect(conflict.status).toBe(409);
    const unavailable = await createTaskRouteHandler({
      authorize: async () => true,
      assign: async () => {
        throw new Error("database down");
      },
    })(request());
    expect(unavailable.status).toBe(503);
    const weakenedPolicy = await createTaskRouteHandler({
      authorize: async () => true,
      assign: async () => ({
        outcome: "CREATED",
        task: {
          schemaVersion: 1,
          id: body.taskId,
          projectId: "project_44444444-4444-4444-4444-444444444444",
          assigneeAgentId: body.agentId,
          title: body.title,
          approvalRequirement: "NOT_REQUIRED",
          idempotencyKey: "task:11111111-1111-1111-1111-111111111111",
          createdAt: "2026-08-13T12:00:00.000Z",
        },
      }),
    })(request());
    expect(weakenedPolicy.status).toBe(503);
  });
});
