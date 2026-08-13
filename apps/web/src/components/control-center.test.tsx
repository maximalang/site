// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
});
