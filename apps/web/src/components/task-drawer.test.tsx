// @vitest-environment jsdom

import { AgentConversationListSchema, TaskAssignmentResponseSchema } from "@agent-world/read-model";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type TaskClient, TaskDrawer } from "./task-drawer";

const agentId = "agent_11111111-1111-1111-1111-111111111111";
const conversationId = "conversation_22222222-2222-2222-2222-222222222222";
const index = AgentConversationListSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-13T10:00:00.000Z",
  agent: { agentId, displayName: "Research Lead" },
  conversations: [
    {
      conversationId,
      projectId: "project_33333333-3333-3333-3333-333333333333",
      title: "Protocol review",
      createdAt: "2026-08-13T09:00:00.000Z",
      taskAssignmentAvailable: true,
    },
  ],
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TaskDrawer", () => {
  it("does not offer a historical Conversation without an active assignment target", async () => {
    render(
      <TaskDrawer
        agent={{ agentId, displayName: "Research Lead" }}
        client={{
          loadIndex: async () =>
            AgentConversationListSchema.parse({
              ...index,
              conversations: index.conversations.map((conversation) => ({
                ...conversation,
                taskAssignmentAvailable: false,
              })),
            }),
          assign: vi.fn(),
        }}
        csrfToken="csrf"
        onAssigned={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("Сначала создайте активный канонический диалог для агента."),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Название")).toBeNull();
  });

  it("reuses one Task id for an exact retry and rotates it after an edit", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("44444444-4444-4444-4444-444444444444")
      .mockReturnValueOnce("55555555-5555-5555-5555-555555555555");
    const assign = vi.fn<TaskClient["assign"]>(async () => {
      throw new Error("offline");
    });
    render(
      <TaskDrawer
        agent={{ agentId, displayName: "Research Lead" }}
        client={{ loadIndex: async () => index, assign }}
        csrfToken="csrf"
        onAssigned={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const title = await screen.findByLabelText("Название");
    await user.type(title, "Verify protocol");
    await user.click(screen.getByRole("button", { name: "Назначить задачу" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Повторить назначение" }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
    expect(assign.mock.calls[0]?.[0].taskId).toBe(assign.mock.calls[1]?.[0].taskId);

    await user.type(title, " again");
    await user.click(screen.getByRole("button", { name: "Назначить задачу" }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(3));
    expect(assign.mock.calls[2]?.[0].taskId).not.toBe(assign.mock.calls[1]?.[0].taskId);
  });

  it("announces an approval-gated success without claiming execution", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("44444444-4444-4444-4444-444444444444");
    const assign = vi.fn<TaskClient["assign"]>(async (input) =>
      TaskAssignmentResponseSchema.parse({
        schemaVersion: 1,
        outcome: "CREATED",
        task: {
          schemaVersion: 1,
          id: input.taskId,
          projectId: "project_33333333-3333-3333-3333-333333333333",
          assigneeAgentId: input.agentId,
          title: input.title,
          approvalRequirement: "REQUIRED",
          idempotencyKey: `task:${input.taskId.slice("task_".length)}`,
          createdAt: "2026-08-13T10:01:00.000Z",
        },
      }),
    );
    render(
      <TaskDrawer
        agent={{ agentId, displayName: "Research Lead" }}
        client={{ loadIndex: async () => index, assign }}
        csrfToken="csrf"
        onAssigned={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText("Название"), "Verify protocol");
    await user.click(screen.getByRole("button", { name: "Назначить задачу" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/требует подтверждения/i);
    expect(status.textContent).toMatch(/запуск не выполнен/i);
  });
});
