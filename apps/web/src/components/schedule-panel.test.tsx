// @vitest-environment jsdom

import { AgentScheduleSchema } from "@agent-world/domain";
import { HubReadModelSchema } from "@agent-world/read-model";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateScheduleInput } from "../client/schedule-api";
import { SchedulePanel } from "./schedule-panel";

const agentId = "agent_55555555-5555-4555-8555-555555555555";
const projectId = "project_66666666-6666-4666-8666-666666666666";
const hub = HubReadModelSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-15T12:00:00.000Z",
  providers: [],
  accounts: [],
  models: [],
  executionRoutes: [],
  skills: [],
  tools: [],
  agents: [
    {
      agentId,
      slug: "researcher",
      displayName: "Researcher",
      role: "Research",
      isEnabled: true,
      skillAssignments: [],
      toolAssignments: [],
    },
  ],
  projects: [
    {
      projectId,
      slug: "world",
      name: "AI World",
      agentIds: [agentId],
      isArchived: false,
      createdAt: "2026-08-15T10:00:00.000Z",
    },
  ],
});
const created = AgentScheduleSchema.parse({
  schemaVersion: 1,
  id: "schedule_77777777-7777-4777-8777-777777777777",
  projectId,
  agentId,
  title: "Daily audit",
  cronExpression: "0 9 * * *",
  timezone: "Europe/Moscow",
  isEnabled: true,
  nextFireAt: "2026-08-16T06:00:00.000Z",
  createdAt: "2026-08-15T12:00:00.000Z",
  updatedAt: "2026-08-15T12:00:00.000Z",
});

afterEach(cleanup);

describe("SchedulePanel", () => {
  it("focuses a newly provisioned Agent handed off by the Hub", async () => {
    const newAgentId = "agent_66666666-6666-4666-8666-666666666666";
    const refreshedHub = HubReadModelSchema.parse({
      ...hub,
      agents: [
        ...hub.agents,
        { ...hub.agents[0], agentId: newAgentId, slug: "reviewer", displayName: "Reviewer" },
      ],
      projects: [{ ...hub.projects[0], agentIds: [agentId, newAgentId] }],
    });
    render(
      <SchedulePanel
        client={{ load: async () => [], create: vi.fn() }}
        csrfToken="csrf"
        focusAgentId={newAgentId}
        hub={refreshedHub}
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Agent") as HTMLSelectElement).value).toBe(newAgentId),
    );
  });

  it("creates a transport-neutral schedule in Simple mode and renders it", async () => {
    const user = userEvent.setup();
    const create = vi.fn(async (_input: CreateScheduleInput, _csrfToken: string) => created);
    render(<SchedulePanel client={{ load: async () => [], create }} csrfToken="csrf" hub={hub} />);
    await screen.findByText("Расписаний пока нет.");
    await user.type(screen.getByLabelText("Название задачи"), "Daily audit");
    await user.click(screen.getByRole("button", { name: "Создать расписание" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      projectId,
      agentId,
      title: "Daily audit",
      cronExpression: "0 9 * * *",
      isEnabled: true,
    });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("accountId");
    expect(await screen.findByText("Расписание создано")).not.toBeNull();
    expect(screen.getByText(/0 9 \* \* \*/)).not.toBeNull();
  });

  it("reveals cron and timezone only in Advanced mode and reports load failure", async () => {
    const user = userEvent.setup();
    render(
      <SchedulePanel
        client={{
          load: async () => {
            throw new Error("db");
          },
          create: vi.fn(),
        }}
        csrfToken="csrf"
        hub={hub}
      />,
    );
    expect(screen.queryByLabelText("Cron (5 полей)")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByLabelText("Cron (5 полей)")).not.toBeNull();
    expect(screen.getByLabelText("Timezone")).not.toBeNull();
    expect(await screen.findByText("Не удалось загрузить или создать расписание")).not.toBeNull();
  });
});
