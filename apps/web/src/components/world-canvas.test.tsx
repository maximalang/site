// @vitest-environment jsdom

import { projectWorldView } from "@agent-world/read-model";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContractFixture } from "../test-fixtures";
import { WorldCanvas } from "./world-canvas";

afterEach(cleanup);

describe("OpenClaw Office World presentation", () => {
  it("renders canonical agents in one four-zone open floor without a canvas", () => {
    const world = projectWorldView(buildContractFixture());
    const { container } = render(
      <WorldCanvas
        world={world}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onOpenConversation={vi.fn()}
      />,
    );
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.getAllByTestId("office-zone")).toHaveLength(4);
    for (const agent of world.agents) {
      expect(screen.getByRole("button", { name: new RegExp(agent.core.displayName) })).toBeTruthy();
    }
  });

  it("keeps selection and conversation actions on native agent controls", () => {
    const world = projectWorldView(buildContractFixture());
    const first = world.agents[0];
    expect(first).toBeDefined();
    if (!first) return;
    const onSelectAgent = vi.fn();
    const onOpenConversation = vi.fn();
    render(
      <WorldCanvas
        world={world}
        selectedAgentId={undefined}
        onSelectAgent={onSelectAgent}
        onOpenConversation={onOpenConversation}
      />,
    );
    const control = screen.getByRole("button", { name: new RegExp(first.core.displayName) });
    fireEvent.click(control);
    fireEvent.doubleClick(control);
    expect(onSelectAgent).toHaveBeenCalledWith(first.core.agentId);
    expect(onOpenConversation).toHaveBeenCalledWith(first.core.agentId);
  });
});
