// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissionPanel } from "./mission-panel";

afterEach(cleanup);

describe("MissionPanel", () => {
  it("creates an active Mission with an explicit success criterion", async () => {
    const user = userEvent.setup();
    const create = vi.fn().mockResolvedValue(undefined);
    render(
      <MissionPanel
        client={{ create }}
        csrfToken="csrf"
        projects={[{ projectId: "project_11111111-1111-1111-1111-111111111111", name: "AI World" }]}
      />,
    );
    await user.type(screen.getByLabelText("Название Mission"), "Finish AI World");
    await user.type(screen.getByLabelText("Цель"), "Meet every production acceptance criterion.");
    await user.type(screen.getByLabelText("Критерий успеха"), "All acceptance gates have evidence");
    await user.click(screen.getByRole("button", { name: "Создать Mission" }));

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        projectId: "project_11111111-1111-1111-1111-111111111111",
        title: "Finish AI World",
        status: "ACTIVE",
        executionPolicy: "REVIEW_EACH_TASK",
        successCriteria: [
          expect.objectContaining({
            statement: "All acceptance gates have evidence",
            status: "PENDING",
            verification: "TEST",
          }),
        ],
      }),
    );
    expect(create.mock.calls[0]?.[1]).toBe("csrf");
    expect(await screen.findByText("Mission создана")).not.toBeNull();
  });

  it("allows the owner to opt into safe automatic handoffs", async () => {
    const user = userEvent.setup();
    const create = vi.fn().mockResolvedValue(undefined);
    render(
      <MissionPanel
        client={{ create }}
        csrfToken="csrf"
        projects={[{ projectId: "project_11111111-1111-1111-1111-111111111111", name: "AI World" }]}
      />,
    );
    await user.click(screen.getByText("Advanced"));
    await user.selectOptions(screen.getByLabelText("Политика выполнения"), "AUTO_SAFE_HANDOFF");
    await user.type(screen.getByLabelText("Название Mission"), "Auto mission");
    await user.type(screen.getByLabelText("Цель"), "Execute safe dependency handoffs.");
    await user.type(screen.getByLabelText("Критерий успеха"), "Review evidence exists");
    await user.click(screen.getByRole("button", { name: "Создать Mission" }));
    expect(create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ executionPolicy: "AUTO_SAFE_HANDOFF" }),
    );
  });
});
