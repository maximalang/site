// @vitest-environment jsdom

import { AgentConversationListSchema, TaskAssignmentResponseSchema } from "@agent-world/read-model";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContractFixture } from "../test-fixtures";
import { ControlCenter } from "./control-center";

vi.mock("./world-canvas", () => ({
  WorldCanvas: () => <div data-testid="world-canvas" />,
}));

afterEach(cleanup);

describe("ControlCenter", () => {
  it("switches World and Command over one read model without losing selection", async () => {
    const user = userEvent.setup();
    const loadReadModel = vi.fn(async () => buildContractFixture());
    render(<ControlCenter csrfToken="csrf" loadReadModel={loadReadModel} />);

    expect(await screen.findByText(/контрактный снимок/i)).not.toBeNull();
    expect(loadReadModel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("world-canvas")).not.toBeNull();

    const researcher = screen.getByRole("button", { name: /Research Lead.*Выполняет/i });
    await user.click(researcher);
    expect(screen.getByRole("heading", { name: "Research Lead" })).not.toBeNull();
    expect(screen.getByText("Verify protocol contract")).not.toBeNull();

    const commandTab = screen.getByRole("tab", { name: "Command" });
    await user.click(commandTab);
    expect(commandTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("world-canvas")).toBeNull();
    expect(screen.getByRole("heading", { name: "Research Lead" })).not.toBeNull();
    expect(
      screen.getByRole("row", {
        name: /Research Lead.*Выполняет.*Verify protocol contract/i,
      }),
    ).not.toBeNull();
  });

  it("supports arrow-key tab switching and a truthful unavailable empty state", async () => {
    const user = userEvent.setup();
    const loadReadModel = vi.fn(async () => ({
      schemaVersion: 1 as const,
      source: "UNAVAILABLE" as const,
      generatedAt: "2026-08-13T06:00:00.000Z",
      cursor: { schemaVersion: 1 as const, stream: "WORLD" as const, lastSequence: 0 },
      agents: [],
      tasks: [],
    }));
    render(<ControlCenter csrfToken="csrf" loadReadModel={loadReadModel} />);

    expect(await screen.findByRole("status", { name: /runtime недоступен/i })).not.toBeNull();
    const worldTab = screen.getByRole("tab", { name: "World" });
    worldTab.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Command" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
  });

  it("does not claim logout when session revocation fails", async () => {
    const user = userEvent.setup();
    render(
      <ControlCenter
        csrfToken="csrf"
        loadReadModel={async () => buildContractFixture()}
        onLogout={async () => {
          throw new Error("revoke unavailable");
        }}
      />,
    );
    await screen.findByRole("heading", { level: 1, name: "AI World" });
    await user.click(screen.getByRole("button", { name: "Выйти" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Выйти" })).not.toBeNull();
  });

  it("assigns a separate approval-gated Task through a canonical conversation", async () => {
    const user = userEvent.setup();
    const loadReadModel = vi.fn(async () => buildContractFixture());
    const assign = vi.fn(
      async (input: { taskId: string; agentId: string; title: string; description?: string }) =>
        TaskAssignmentResponseSchema.parse({
          schemaVersion: 1 as const,
          outcome: "CREATED" as const,
          task: {
            schemaVersion: 1 as const,
            id: input.taskId,
            projectId: "project_33333333-3333-3333-3333-333333333333",
            assigneeAgentId: input.agentId,
            title: input.title,
            ...(input.description === undefined ? {} : { description: input.description }),
            approvalRequirement: "REQUIRED" as const,
            idempotencyKey: `task:${input.taskId.slice("task_".length)}`,
            createdAt: "2026-08-13T12:00:00.000Z",
          },
        }),
    );
    render(
      <ControlCenter
        csrfToken="csrf"
        loadReadModel={loadReadModel}
        taskClient={{
          loadIndex: async () =>
            AgentConversationListSchema.parse({
              schemaVersion: 1,
              generatedAt: "2026-08-13T11:00:00.000Z",
              agent: {
                agentId: "agent_11111111-1111-1111-1111-111111111111",
                displayName: "Research Lead",
              },
              conversations: [
                {
                  conversationId: "conversation_55555555-5555-5555-5555-555555555555",
                  projectId: "project_33333333-3333-3333-3333-333333333333",
                  title: "Protocol review",
                  createdAt: "2026-08-13T10:00:00.000Z",
                  taskAssignmentAvailable: true,
                },
              ],
            }),
          assign,
        }}
      />,
    );
    await screen.findByRole("heading", { level: 1, name: "AI World" });
    await user.click(screen.getByRole("button", { name: /Research Lead.*Выполняет/i }));
    await user.click(screen.getByRole("button", { name: "Назначить задачу" }));
    expect(await screen.findByRole("heading", { name: "Задача для Research Lead" })).not.toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Задача для Research Lead" });
    await user.type(screen.getByLabelText("Название"), "Проверить новый контракт");
    await user.type(screen.getByLabelText("Описание"), "Сохранить ссылки на источники.");
    await user.click(within(dialog).getByRole("button", { name: "Назначить задачу" }));
    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation_55555555-5555-5555-5555-555555555555",
        agentId: "agent_11111111-1111-1111-1111-111111111111",
        title: "Проверить новый контракт",
        csrfToken: "csrf",
      }),
    );
    expect(await within(dialog).findByText(/требует подтверждения/i)).not.toBeNull();
    await waitFor(() => expect(loadReadModel).toHaveBeenCalledTimes(2));
  });
});
