// @vitest-environment jsdom

import { HubReadModelSchema } from "@agent-world/read-model";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubPanel } from "./hub-panel";

const fixture = HubReadModelSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-13T12:00:00.000Z",
  providers: [
    {
      providerId: "provider_11111111-1111-1111-1111-111111111111",
      slug: "openai",
      displayName: "OpenAI",
      kind: "OPENAI",
      category: "LLM_API",
      isEnabled: true,
    },
  ],
  accounts: [],
  models: [
    {
      modelId: "model_22222222-2222-2222-2222-222222222222",
      slug: "gpt-x",
      displayName: "GPT-X",
      family: "gpt",
      capabilities: {
        reasoning: true,
        toolUse: true,
        modalities: ["TEXT"],
        contextWindowTokens: 200000,
      },
      isEnabled: true,
      routes: [
        {
          modelRouteId: "model_route_33333333-3333-3333-3333-333333333333",
          providerId: "provider_11111111-1111-1111-1111-111111111111",
          surface: "API",
          remoteModelId: "gpt-x-primary",
          availability: "AVAILABLE",
          contextWindowTokens: 200000,
          reasoningEfforts: ["HIGH"],
          supportedModalities: ["TEXT"],
          supportedToolIds: [],
          isEnabled: true,
        },
        {
          modelRouteId: "model_route_44444444-4444-4444-4444-444444444444",
          providerId: "provider_11111111-1111-1111-1111-111111111111",
          surface: "API",
          remoteModelId: "gpt-x-fallback",
          availability: "UNKNOWN",
          contextWindowTokens: 200000,
          reasoningEfforts: [],
          supportedModalities: ["TEXT"],
          supportedToolIds: [],
          isEnabled: true,
        },
      ],
    },
  ],
  executionRoutes: [],
  agents: [
    {
      agentId: "agent_55555555-5555-5555-5555-555555555555",
      slug: "researcher",
      displayName: "Researcher",
      role: "Evidence-first research",
      isEnabled: true,
      skillAssignments: [],
      toolAssignments: [],
    },
  ],
  skills: [],
  tools: [],
  projects: [],
});

afterEach(cleanup);

describe("HubPanel", () => {
  it("renders one CanonicalModel card with nested routes and selects canonical Agents", async () => {
    const user = userEvent.setup();
    const onSelectAgent = vi.fn();
    render(<HubPanel load={async () => fixture} onSelectAgent={onSelectAgent} />);

    expect(await screen.findByRole("heading", { name: "Canonical Hub" })).not.toBeNull();
    expect(screen.getAllByRole("heading", { name: "GPT-X" })).toHaveLength(1);
    expect(screen.getByText("2 маршрута")).not.toBeNull();
    const summary = screen.getByText("Параметры маршрутов");
    expect(summary.closest("details")?.hasAttribute("open")).toBe(false);
    await user.click(summary);
    expect(summary.closest("details")?.hasAttribute("open")).toBe(true);
    expect(screen.getByText("gpt-x-primary")).not.toBeNull();
    expect(screen.getByText("gpt-x-fallback")).not.toBeNull();
    expect(screen.getAllByText("EXPERIMENTAL · not selectable")).toHaveLength(2);
    expect(screen.getByText("OFFICIAL · selectable")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /Researcher.*Evidence-first research/i }));
    expect(onSelectAgent).toHaveBeenCalledWith(fixture.agents[0]?.agentId);
  });

  it("shows only the active Hub section and keeps one shared read-model load", async () => {
    const user = userEvent.setup();
    const load = vi.fn(async () => fixture);
    render(<HubPanel load={load} onSelectAgent={vi.fn()} />);

    await screen.findByRole("heading", { name: "Canonical Hub" });
    const registryTab = screen.getByRole("tab", { name: "Реестр" });
    const setupTab = screen.getByRole("tab", { name: "Настройка" });
    expect(registryTab.getAttribute("aria-selected")).toBe("true");
    expect(setupTab.getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByRole("heading", { name: "ChatGPT Accounts" })).toBeNull();

    await user.click(setupTab);
    expect(setupTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "ChatGPT Accounts" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Новая Mission" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Новый Agent" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Канонические модели" })).toBeNull();

    setupTab.focus();
    await user.keyboard("{ArrowRight}");
    const runtimeTab = screen.getByRole("tab", { name: "Runtime" });
    expect(runtimeTab).toHaveFocus();
    expect(runtimeTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Operations" })).not.toBeNull();

    await user.keyboard("{ArrowLeft}");
    expect(setupTab).toHaveFocus();
    expect(setupTab.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{End}");
    const routingTab = screen.getByRole("tab", { name: "Маршруты" });
    expect(routingTab).toHaveFocus();
    expect(routingTab.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{Home}");
    expect(registryTab).toHaveFocus();
    expect(registryTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Канонические модели" })).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shows explicit empty collections without inventing infrastructure", async () => {
    const empty = HubReadModelSchema.parse({
      ...fixture,
      providers: [],
      models: [],
      agents: [],
    });
    render(<HubPanel load={async () => empty} onSelectAgent={vi.fn()} />);
    expect(await screen.findByText("Провайдеры пока не добавлены")).not.toBeNull();
    expect(screen.getByText("Канонические модели пока не добавлены")).not.toBeNull();
    expect(screen.getByText("Агенты пока не добавлены")).not.toBeNull();
  });

  it("fails closed and retries a rejected read model", async () => {
    const user = userEvent.setup();
    const load = vi
      .fn<() => Promise<typeof fixture>>()
      .mockRejectedValueOnce(new Error("private database detail"))
      .mockResolvedValueOnce(fixture);
    render(<HubPanel load={load} onSelectAgent={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Hub недоступен");
    expect(screen.queryByText("private database detail")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { name: "Canonical Hub" })).not.toBeNull();
  });
});
