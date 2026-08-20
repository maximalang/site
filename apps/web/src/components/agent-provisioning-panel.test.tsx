// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProvisioningPanel } from "./agent-provisioning-panel";

afterEach(cleanup);

describe("AgentProvisioningPanel", () => {
  it("creates one Template-backed Agent Instance with skills, tools, memory and budget policy", async () => {
    const user = userEvent.setup();
    const execute = vi.fn().mockResolvedValue(undefined);
    const onProvisioned = vi.fn();
    const onConfigureSchedule = vi.fn();
    render(
      <AgentProvisioningPanel
        csrfToken="csrf"
        client={{ execute }}
        onConfigureSchedule={onConfigureSchedule}
        onProvisioned={onProvisioned}
        projects={[{ projectId: "project_11111111-1111-1111-1111-111111111111", name: "AI World" }]}
        skills={[
          { skillId: "skill_11111111-1111-1111-1111-111111111111", displayName: "Research" },
        ]}
        tools={[{ toolId: "tool_11111111-1111-1111-1111-111111111111", displayName: "Browser" }]}
      />,
    );
    await user.type(screen.getByLabelText("Имя агента"), "Research Lead");
    await user.type(screen.getByLabelText("Slug"), "research-lead");
    await user.type(screen.getByLabelText("Роль"), "Evidence lead");
    await user.type(screen.getByLabelText("Инструкции"), "Use primary evidence.");
    await user.click(screen.getByLabelText("Research"));
    await user.click(screen.getByLabelText("Browser"));
    await user.click(screen.getByText("Расширенные настройки"));
    await user.selectOptions(screen.getByLabelText("Контекст памяти"), "RICH");
    await user.selectOptions(screen.getByLabelText("Бюджет токенов"), "QUALITY");
    await user.selectOptions(screen.getByLabelText("Предпочтительный режим выполнения"), "CHAT");
    await user.click(screen.getByRole("button", { name: "Создать агента" }));
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "AGENT_CREATE",
        provisioning: expect.objectContaining({
          projectId: "project_11111111-1111-1111-1111-111111111111",
          skillIds: ["skill_11111111-1111-1111-1111-111111111111"],
          toolIds: ["tool_11111111-1111-1111-1111-111111111111"],
          preferences: { mode: "CHAT", context: "RICH", budget: "QUALITY" },
        }),
      }),
      "csrf",
    );
    expect(await screen.findByText("Агент создан")).not.toBeNull();
    expect(onProvisioned).toHaveBeenCalledWith(expect.stringMatching(/^agent_/));
    const scheduleButton = screen.getByRole("button", { name: "Настроить расписание" });
    await user.click(scheduleButton);
    expect(onConfigureSchedule).toHaveBeenCalledWith(onProvisioned.mock.calls[0]?.[0]);
  });
});
