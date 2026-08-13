import { describe, expect, it } from "vitest";
import { TaskAssignmentRequestSchema, TaskAssignmentResponseSchema } from "./task-assignment.js";

const task = {
  schemaVersion: 1,
  id: "task_11111111-1111-1111-1111-111111111111",
  projectId: "project_22222222-2222-2222-2222-222222222222",
  assigneeAgentId: "agent_33333333-3333-3333-3333-333333333333",
  title: "Verify protocol",
  approvalRequirement: "REQUIRED",
  idempotencyKey: "task:11111111-1111-1111-1111-111111111111",
  createdAt: "2026-08-13T12:00:00.000Z",
};

describe("task assignment contract", () => {
  it("does not accept server-owned project or approval fields from a caller", () => {
    expect(
      TaskAssignmentRequestSchema.safeParse({
        schemaVersion: 1,
        taskId: task.id,
        conversationId: "conversation_44444444-4444-4444-4444-444444444444",
        agentId: task.assigneeAgentId,
        title: task.title,
        projectId: task.projectId,
        approvalRequirement: "NOT_REQUIRED",
      }).success,
    ).toBe(false);
  });

  it("requires every successful assignment to remain approval-gated", () => {
    expect(
      TaskAssignmentResponseSchema.safeParse({
        schemaVersion: 1,
        outcome: "CREATED",
        task,
      }).success,
    ).toBe(true);
    expect(
      TaskAssignmentResponseSchema.safeParse({
        schemaVersion: 1,
        outcome: "CREATED",
        task: { ...task, approvalRequirement: "NOT_REQUIRED" },
      }).success,
    ).toBe(false);
  });
});
