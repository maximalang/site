// @vitest-environment jsdom

import {
  AgentConversationListSchema,
  ApprovalDecisionResponseSchema,
  TaskAssignmentResponseSchema,
} from "@agent-world/read-model";
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

  it("requires a separate explicit decision before dispatch", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("55555555-5555-4555-8555-555555555555");
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
    const decide = vi.fn<NonNullable<TaskClient["decide"]>>(async (input) =>
      ApprovalDecisionResponseSchema.parse({
        schemaVersion: 1,
        outcome: "DECIDED",
        approval: {
          type: "APPROVED",
          approvalId: `approval_${input.taskId.slice("task_".length)}`,
          decidedAt: "2026-08-13T10:02:00.000Z",
        },
        run: {
          schemaVersion: 1,
          id: `run_${input.taskId.slice("task_".length)}`,
          taskId: input.taskId,
          agentId,
          approvalId: `approval_${input.taskId.slice("task_".length)}`,
          adapterKind: "OPENCLAW",
          bindingId: "binding_66666666-6666-6666-6666-666666666666",
          sessionId: "session_77777777-7777-7777-7777-777777777777",
          status: "DISPATCH_PENDING",
          attempt: 0,
          dispatchIdempotencyKey: `run:${input.taskId.slice("task_".length)}`,
          createdAt: "2026-08-13T10:02:00.000Z",
        },
        dispatch: "PENDING",
      }),
    );
    const onDecided = vi.fn();
    render(
      <TaskDrawer
        agent={{ agentId, displayName: "Research Lead" }}
        client={{ loadIndex: async () => index, assign, decide }}
        csrfToken="csrf"
        onAssigned={vi.fn()}
        onClose={vi.fn()}
        onDecided={onDecided}
      />,
    );

    await user.type(await screen.findByLabelText("Название"), "Verify protocol");
    await user.click(screen.getByRole("button", { name: "Назначить задачу" }));
    expect(decide).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Подтвердить и запустить" }));
    await waitFor(() => expect(decide).toHaveBeenCalledOnce());
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "APPROVE",
        decisionId: "55555555-5555-4555-8555-555555555555",
      }),
    );
    expect(
      await screen.findByText("Задача подтверждена и ожидает доступный runtime."),
    ).not.toBeNull();
    expect(onDecided).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Повторить отправку" }));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
    expect(decide.mock.calls[1]?.[0].decisionId).toBe(decide.mock.calls[0]?.[0].decisionId);
  });
});
