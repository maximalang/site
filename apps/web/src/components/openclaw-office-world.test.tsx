// @vitest-environment jsdom

import { projectWorldView } from "@agent-world/read-model";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildContractFixture } from "../test-fixtures";
import { OpenClawOfficeWorld } from "./openclaw-office-world";

class ResizeObserverStub {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Phase 6 living World renderer", () => {
  it("renders a game canvas and removes the rejected map selector", () => {
    const world = projectWorldView(buildContractFixture());
    const { container } = render(
      <OpenClawOfficeWorld world={world} selectedAgentId={undefined} onSelectAgent={vi.fn()} onOpenConversation={vi.fn()} />,
    );
    expect(screen.getByLabelText(/Интерактивная пиксельная карта мира агентов/i)).toBeTruthy();
    expect(container.querySelector('[data-renderer="agent-world-canvas-v1"]')).toBeTruthy();
    expect(screen.queryByLabelText("Вид карты")).toBeNull();
    expect(container.querySelector("svg.office-floor")).toBeNull();
  });

  it("provides native keyboard-accessible selection and conversation controls", () => {
    const world = projectWorldView(buildContractFixture());
    const first = world.agents[0];
    expect(first).toBeDefined();
    if (!first) return;
    const onSelectAgent = vi.fn();
    const onOpenConversation = vi.fn();
    render(
      <OpenClawOfficeWorld world={world} selectedAgentId={undefined} onSelectAgent={onSelectAgent} onOpenConversation={onOpenConversation} />,
    );
    const control = screen.getByRole("button", { name: new RegExp(`^${first.core.displayName}:`) });
    fireEvent.click(control);
    fireEvent.doubleClick(control);
    expect(onSelectAgent).toHaveBeenCalledWith(first.core.agentId);
    expect(onOpenConversation).toHaveBeenCalledWith(first.core.agentId);
  });

  it("replays exactly the supplied canonical handoff in-world", () => {
    const world = projectWorldView(buildContractFixture());
    const { container } = render(
      <OpenClawOfficeWorld world={world} selectedAgentId={undefined} onSelectAgent={vi.fn()} onOpenConversation={vi.fn()} />,
    );
    expect(container.querySelector("[data-handoff-cue]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Показать передачу" }));
    expect(screen.getByRole("status").textContent).toContain("Research Lead → Reviewer");
    expect(container.querySelectorAll("[data-handoff-cue]")).toHaveLength(1);
  });

  it("shows selected canonical task/activity context over the world", () => {
    const world = projectWorldView(buildContractFixture());
    const research = world.agents.find((entry) => entry.core.displayName === "Research Lead");
    expect(research).toBeDefined();
    if (!research) return;
    render(
      <OpenClawOfficeWorld world={world} selectedAgentId={research.core.agentId} onSelectAgent={vi.fn()} onOpenConversation={vi.fn()} />,
    );
    expect(screen.getByText("Verify protocol contract")).toBeTruthy();
    expect(screen.getByText(/Передача с Reviewer/)).toBeTruthy();
  });
});
