import { describe, expect, it, vi } from "vitest";
import { assignTask } from "./task-api";

const input = {
  taskId: "task_11111111-1111-1111-1111-111111111111",
  conversationId: "conversation_22222222-2222-2222-2222-222222222222",
  agentId: "agent_33333333-3333-3333-3333-333333333333",
  title: "Verify protocol",
  description: "Use primary sources.",
  csrfToken: "csrf",
};

describe("task assignment client", () => {
  it("sends only caller-owned assignment fields with in-memory CSRF", async () => {
    const result = {
      schemaVersion: 1 as const,
      outcome: "CREATED" as const,
      task: {
        schemaVersion: 1 as const,
        id: input.taskId,
        projectId: "project_44444444-4444-4444-4444-444444444444",
        assigneeAgentId: input.agentId,
        title: input.title,
        description: input.description,
        approvalRequirement: "REQUIRED" as const,
        idempotencyKey: "task:11111111-1111-1111-1111-111111111111",
        createdAt: "2026-08-13T12:00:00.000Z",
      },
    };
    const fetcher = vi.fn(async () => Response.json(result, { status: 201 }));

    await expect(assignTask(input, fetcher)).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith("/api/tasks", {
      body: JSON.stringify({
        schemaVersion: 1,
        taskId: input.taskId,
        conversationId: input.conversationId,
        agentId: input.agentId,
        title: input.title,
        description: input.description,
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Agent-World-CSRF": "csrf" },
      method: "POST",
    });
  });

  it("rejects a response that weakens the mandatory approval policy", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        schemaVersion: 1,
        outcome: "CREATED",
        task: {
          schemaVersion: 1,
          id: input.taskId,
          projectId: "project_44444444-4444-4444-4444-444444444444",
          assigneeAgentId: input.agentId,
          title: input.title,
          approvalRequirement: "NOT_REQUIRED",
          idempotencyKey: "task:11111111-1111-1111-1111-111111111111",
          createdAt: "2026-08-13T12:00:00.000Z",
        },
      }),
    );

    await expect(assignTask(input, fetcher)).rejects.toThrow("Invalid task assignment response");
  });
});
