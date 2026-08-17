// @vitest-environment jsdom

import { projectWorldView } from "@agent-world/read-model";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContractFixture } from "../test-fixtures";
import { OpenClawOfficeWorld } from "./openclaw-office-world";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("OpenClaw Office World presentation", () => {
  it("renders canonical agents in one four-zone open floor without a canvas", () => {
    const world = projectWorldView(buildContractFixture());
    const { container } = render(
      <OpenClawOfficeWorld
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
    expect(container.querySelectorAll("[data-openclaw-primitive='desk']").length).toBeGreaterThan(
      1,
    );
    expect(container.querySelector("[data-openclaw-primitive='meeting-table']")).toBeTruthy();
    expect(container.querySelector("[data-openclaw-primitive='sofa']")).toBeTruthy();
    expect(container.querySelector("[data-openclaw-primitive='plant']")).toBeTruthy();
    expect(container.querySelectorAll("[data-openclaw-primitive='pawn']")).toHaveLength(
      world.agents.length,
    );
    expect(container.querySelectorAll(".office-monitor-active")).toHaveLength(
      world.agents.filter((agent) => agent.core.status === "RUNNING").length,
    );
  });

  it("keeps selection and conversation actions on native agent controls", () => {
    const world = projectWorldView(buildContractFixture());
    const first = world.agents[0];
    expect(first).toBeDefined();
    if (!first) return;
    const onSelectAgent = vi.fn();
    const onOpenConversation = vi.fn();
    render(
      <OpenClawOfficeWorld
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

  it("renders only canonical action cues and keeps them inert", () => {
    const world = projectWorldView(buildContractFixture());
    const { container } = render(
      <OpenClawOfficeWorld
        world={world}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onOpenConversation={vi.fn()}
      />,
    );
    const cues = [...container.querySelectorAll("[data-action-cue]")].map((element) =>
      element.getAttribute("data-action-cue"),
    );
    expect(cues.every((cue) => ["NONE", "WORK", "REVIEW"].includes(cue ?? ""))).toBe(true);
    expect(container.querySelector("[data-action-cue='HANDOFF']")).toBeNull();
    expect(container.querySelector("[data-action-cue='MEETING']")).toBeNull();
  });

  it("exposes a canonical handoff as text as well as a decorative map cue", () => {
    const world = projectWorldView(buildContractFixture());
    const { container } = render(
      <OpenClawOfficeWorld
        world={world}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onOpenConversation={vi.fn()}
      />,
    );

    expect(screen.getByText("Research Lead → Reviewer")).toBeTruthy();
    expect(container.querySelectorAll("[data-handoff-cue]")).toHaveLength(1);
  });

  it("persists a user skin preference without changing canonical agents and resets to project skin", () => {
    const world = projectWorldView(buildContractFixture());
    const { container } = render(
      <OpenClawOfficeWorld
        world={world}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onOpenConversation={vi.fn()}
        projectSkinId="minimal-grid-v1"
      />,
    );

    const worldSurface = container.querySelector("[data-skin]");
    expect(worldSurface?.getAttribute("data-skin")).toBe("minimal-grid-v1");
    expect(worldSurface?.getAttribute("data-theme")).toBe("MINIMAL_GRID");

    fireEvent.change(screen.getByLabelText("Map / skin"), {
      target: { value: "space-station-v1" },
    });

    expect(worldSurface?.getAttribute("data-skin")).toBe("space-station-v1");
    expect(worldSurface?.getAttribute("data-theme")).toBe("SPACE_STATION");
    expect(window.localStorage.getItem("agent-world.office-skin.v1")).toBe("space-station-v1");
    for (const agent of world.agents) {
      expect(screen.getByRole("button", { name: new RegExp(agent.core.displayName) })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: "Project / system default" }));
    expect(worldSurface?.getAttribute("data-skin")).toBe("minimal-grid-v1");
    expect(worldSurface?.getAttribute("data-theme")).toBe("MINIMAL_GRID");
    expect(window.localStorage.getItem("agent-world.office-skin.v1")).toBeNull();
  });
});
