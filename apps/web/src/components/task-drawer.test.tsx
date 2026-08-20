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
const projectId = "project_33333333-3333-3333-3333-333333333333";
const index = AgentConversationListSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-13T10:00:00.000Z",
  agent: { agentId, displayName: "Research Lead" },
  conversations: [
    {
      conversationId,
      projectId,
      title: "Protocol review",
      createdAt: "2026-08-13T09:00:00.000Z",
      taskAssignmentAvailable: true,
    },
  ],
});

function assignmentResponse(input: Parameters<TaskClient["assign"]>[0]) {
  return TaskAssignmentResponseSchema.parse({
    schemaVersion: 1,
    outcome: "CREATED",
    task: {
      schemaVersion: 1,
      id: input.taskId,
      projectId,
      assigneeAgentId: input.agentId,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      approvalRequirement: "REQUIRED",
      idempotencyKey: `task:${input.taskId.slice("task_".length)}`,
      createdAt: "2026-08-13T10:01:00.000Z",
    },
  });
}

function approvedPendingResponse(taskId: string) {
  const rawId = taskId.slice("task_".length);
  return ApprovalDecisionResponseSchema.parse({
    schemaVersion: 1,
    outcome: "DECIDED",
    approval: {
      type: "APPROVED",
      approvalId: `approval_${rawId}`,
      decidedAt: "2026-08-13T10:02:00.000Z",
    },
    run: {
      schemaVersion: 1,
      id: `run_${rawId}`,
      taskId,
      agentId,
      approvalId: `approval_${rawId}`,
      adapterKind: "OPENCLAW",
      bindingId: "binding_66666666-6666-6666-6666-666666666666",
      sessionId: "session_77777777-7777-7777-7777-777777777777",
      status: "DISPATCH_PENDING",
      attempt: 0,
      dispatchIdempotencyKey: `run:${rawId}`,
      createdAt: "2026-08-13T10:02:00.000Z",
    },
    execution: {
      routeId: "route_88888888-8888-8888-8888-888888888888",
      accountId: "account_99999999-9999-9999-9999-999999999999",
      mode: "CODEX",
      adapterKind: "CODEX",
      modelRouteId: "model_route_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      remoteModelId: "gpt-5.6-codex",
    },
    dispatch: "PENDING",
  });
}

function negativeDecisionResponse(taskId: string, kind: "DENY" | "REVOKE", reason: string) {
  return ApprovalDecisionResponseSchema.parse({
    schemaVersion: 1,
    outcome: "DECIDED",
    approval: {
      type: kind === "DENY" ? "DENIED" : "REVOKED",
      approvalId: `approval_${taskId.slice("task_".length)}`,
      decidedAt: "2026-08-13T10:03:00.000Z",
      reason,
    },
    dispatch: "NOT_APPLICABLE",
  });
}

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

  it("replaces the completed composer with a compact assignment summary and immediate approval actions", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("44444444-4444-4444-8444-444444444444");
    const assign = vi.fn<TaskClient["assign"]>(async (input) => assignmentResponse(input));
    render(
      <TaskDrawer
        agent={{ agentId, displayName: "Research Lead" }}
        client={{ loadIndex: async () => index, assign, decide: vi.fn() }}
        csrfToken="csrf"
        onAssigned={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText("Название"), "Проверить новый контракт");
    await user.type(screen.getByLabelText("Описание"), "Сохранить ссылки на источники.");
    await user.click(screen.getByRole("button", { name: "Назначить задачу" }));

    expect(await screen.findByRole("heading", { name: "Задача назначена" })).not.toBeNull();
    expect(screen.getByText("Protocol review")).not.toBeNull();
    expect(screen.getByText("Проверить новый контракт")).not.toBeNull();
    expect(screen.getByText("Сохранить ссылки на источники.")).not.toBeNull();
    expect(screen.queryByLabelText("Название")).toBeNull();
    expect(screen.queryByLabelText("Описание")).toBeNull();
    expect(screen.getByRole("button", { name: "Подтвердить и запустить" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Отклонить" })).not.toBeNull();
    expect(screen.queryByLabelText("Причина отклонения")).toBeNull();
  });

  it("opens rejection mode without deciding, requires a trimmed reason, and restores focus on cancel", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("55555555-5555-4555-8555-555555555555");
    const assign = vi.fn<TaskClient["assign"]>(async (input) => assignmentResponse(input));
    const decide = vi.fn<NonNullable<TaskClient["decide"]>>(async (input) =>
      negativeDecisionResponse(input.taskId, "DENY", input.reason ?? ""),
    );
    render(
      <TaskDrawer
        agent={{ agentId, displayName: "Research Lead" }}
        client={{ loadIndex: async () => index, assign, decide }}
        csrfToken="csrf"
        onAssigned={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText("Название"), "Verify protocol");
    await user.click(screen.getByRole("button", { name: "Назначить задачу" }));
    const reject = await screen.findByRole("button", { name: "Отклонить" });
    expect(screen.queryByLabelText("Причина отклонения")).toBeNull();

    await user.click(reject);
    expect(decide).not.toHaveBeenCalled();
    const reason = screen.getByLabelText("Причина отклонения");
    expect(document.activeElement).toBe(reason);
    const confirm = screen.getByRole("button", { name: "Подтвердить отклонение" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(reason, "  Duplicate request  ");
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByLabelText("Причина отклонения")).toBeNull();
    expect(decide).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(reject));

    await user.click(reject);
    await user.type(screen.getByLabelText("Причина отклонения"), "  Duplicate request  ");
    await user.click(screen.getByRole("button", { name: "Подтвердить отклонение" }));
    await waitFor(() => expect(decide).toHaveBeenCalledOnce());
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "DENY",
        decisionId: "55555555-5555-4555-8555-555555555555",
        reason: "Duplicate request",
      }),
    );
  });

  it("reuses a failed DENY decision id and rotates it when the reason changes", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("55555555-5555-4555-8555-555555555555")
      .mockReturnValueOnce("66666666-6666-4666-8666-666666666666");
    const assign = vi.fn<TaskClient["assign"]>(async (input) => assignmentResponse(input));
    let attempts = 0;
    const decide = vi.fn<NonNullable<TaskClient["decide"]>>(async (input) => {
      attempts += 1;
      if (attempts <= 2) throw new Error("offline");
      return negativeDecisionResponse(input.taskId, "DENY", input.reason ?? "");
    });
    render(
      <TaskDrawer
        agent={{ agentId, displayName: "Research Lead" }}
        client={{ loadIndex: async () => index, assign, decide }}
        csrfToken="csrf"
        onAssigned={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText("Название"), "Verify protocol");
    await user.click(screen.getByRole("button", { name: "Назначить задачу" }));
    await user.click(await screen.findByRole("button", { name: "Отклонить" }));
    const reason = screen.getByLabelText("Причина отклонения");
    await user.type(reason, "  Duplicate request  ");
    const confirm = screen.getByRole("button", { name: "Подтвердить отклонение" });

    await user.click(confirm);
    expect(await screen.findByRole("alert")).not.toBeNull();
    await user.click(confirm);
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
    expect(decide.mock.calls[1]?.[0].decisionId).toBe(decide.mock.calls[0]?.[0].decisionId);
    expect(decide.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        decision: "DENY",
        decisionId: "55555555-5555-4555-8555-555555555555",
        reason: "Duplicate request",
      }),
    );

    await user.type(reason, " updated");
    await user.click(confirm);
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(3));
    expect(decide.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        decision: "DENY",
        decisionId: "66666666-6666-4666-8666-666666666666",
        reason: "Duplicate request updated",
      }),
    );
  });

  it("keeps approve direct and reuses the same decision id for pending dispatch retry", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("55555555-5555-4555-8555-555555555555");
    const assign = vi.fn<TaskClient["assign"]>(async (input) => assignmentResponse(input));
    const decide = vi.fn<NonNullable<TaskClient["decide"]>>(async (input) =>
      approvedPendingResponse(input.taskId),
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
    expect(screen.getByText("account_99999999-9999-9999-9999-999999999999")).not.toBeNull();
    expect(screen.getByText("gpt-5.6-codex")).not.toBeNull();
    expect(screen.getAllByText("CODEX")).toHaveLength(2);
    expect(screen.queryByLabelText("Причина отзыва")).toBeNull();
    expect(onDecided).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Повторить отправку" }));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
    expect(decide.mock.calls[1]?.[0].decisionId).toBe(decide.mock.calls[0]?.[0].decisionId);
  });

  it("opens revoke mode without an API call and only confirms revoke with a required reason", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("55555555-5555-4555-8555-555555555555")
      .mockReturnValueOnce("66666666-6666-4666-8666-666666666666");
    const assign = vi.fn<TaskClient["assign"]>(async (input) => assignmentResponse(input));
    const decide = vi.fn<NonNullable<TaskClient["decide"]>>(async (input) =>
      input.decision === "REVOKE"
        ? negativeDecisionResponse(input.taskId, "REVOKE", input.reason ?? "")
        : approvedPendingResponse(input.taskId),
    );
    render(
      <TaskDrawer
        agent={{ agentId, displayName: "Research Lead" }}
        client={{ loadIndex: async () => index, assign, decide }}
        csrfToken="csrf"
        onAssigned={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText("Название"), "Verify protocol");
    await user.click(screen.getByRole("button", { name: "Назначить задачу" }));
    await user.click(screen.getByRole("button", { name: "Подтвердить и запустить" }));
    await waitFor(() => expect(decide).toHaveBeenCalledOnce());

    const revoke = screen.getByRole("button", { name: "Отозвать разрешение" });
    expect(screen.queryByLabelText("Причина отзыва")).toBeNull();
    await user.click(revoke);
    expect(decide).toHaveBeenCalledOnce();
    const reason = screen.getByLabelText("Причина отзыва");
    expect(document.activeElement).toBe(reason);
    const confirm = screen.getByRole("button", { name: "Подтвердить отзыв" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.type(reason, "  Changed priorities  ");
    await user.click(confirm);
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
    expect(decide.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        decision: "REVOKE",
        decisionId: "66666666-6666-4666-8666-666666666666",
        reason: "Changed priorities",
      }),
    );
  });

  it("keeps APPROVE retry identity while a failed REVOKE is cancelled and retried", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("55555555-5555-4555-8555-555555555555")
      .mockReturnValueOnce("66666666-6666-4666-8666-666666666666")
      .mockReturnValueOnce("77777777-7777-4777-8777-777777777777");
    const assign = vi.fn<TaskClient["assign"]>(async (input) => assignmentResponse(input));
    let revokeAttempts = 0;
    const decide = vi.fn<NonNullable<TaskClient["decide"]>>(async (input) => {
      if (input.decision === "APPROVE") return approvedPendingResponse(input.taskId);
      revokeAttempts += 1;
      if (revokeAttempts === 1) throw new Error("offline");
      return negativeDecisionResponse(input.taskId, "REVOKE", input.reason ?? "");
    });
    render(
      <TaskDrawer
        agent={{ agentId, displayName: "Research Lead" }}
        client={{ loadIndex: async () => index, assign, decide }}
        csrfToken="csrf"
        onAssigned={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText("Название"), "Verify protocol");
    await user.click(screen.getByRole("button", { name: "Назначить задачу" }));
    await user.click(screen.getByRole("button", { name: "Подтвердить и запустить" }));
    await waitFor(() => expect(decide).toHaveBeenCalledOnce());
    expect(decide.mock.calls[0]?.[0].decisionId).toBe("55555555-5555-4555-8555-555555555555");

    const revoke = screen.getByRole("button", { name: "Отозвать разрешение" });
    await user.click(revoke);
    await user.type(screen.getByLabelText("Причина отзыва"), "Changed priorities");
    await user.click(screen.getByRole("button", { name: "Подтвердить отзыв" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(decide.mock.calls[1]?.[0].decisionId).toBe("66666666-6666-4666-8666-666666666666");

    await user.click(screen.getByRole("button", { name: "Отмена" }));
    await user.click(screen.getByRole("button", { name: "Повторить отправку" }));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(3));
    expect(decide.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        decision: "APPROVE",
        decisionId: "55555555-5555-4555-8555-555555555555",
      }),
    );

    await user.click(revoke);
    await user.type(screen.getByLabelText("Причина отзыва"), "Changed priorities");
    await user.click(screen.getByRole("button", { name: "Подтвердить отзыв" }));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(4));
    expect(decide.mock.calls[3]?.[0]).toEqual(
      expect.objectContaining({
        decision: "REVOKE",
        decisionId: "66666666-6666-4666-8666-666666666666",
        reason: "Changed priorities",
      }),
    );
  });
});
