// @vitest-environment jsdom

import { HubReadModelSchema, OperationsReadModelSchema } from "@agent-world/read-model";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubPanel } from "./hub-panel";

const projectId = "project_77777777-7777-7777-7777-777777777777";
const agentId = "agent_55555555-5555-5555-5555-555555555555";

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
      agentId,
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
  projects: [
    {
      projectId,
      slug: "ai-world",
      name: "AI World",
      isArchived: false,
      createdAt: "2026-08-13T12:00:00.000Z",
      agentIds: [agentId],
    },
  ],
});

const operationsFixture = OperationsReadModelSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-13T12:00:00.000Z",
  actionGraph: { nodes: [], edges: [] },
  observatory: {
    runs: { total: 0, completed: 0, failed: 0 },
    tokens: { input: 0, cachedInput: 0, output: 0 },
    context: { estimatedTokens: 0, budgetTokens: 0, pressure: 0 },
    monetaryCost: { status: "UNAVAILABLE" },
    routeSignals: [],
  },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it("keeps six stable tabpanels, one active section and one shared read-model load", async () => {
    const user = userEvent.setup();
    const load = vi.fn(async () => fixture);
    render(<HubPanel load={load} onSelectAgent={vi.fn()} />);

    await screen.findByRole("heading", { name: "Canonical Hub" });
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(6);
    const panels = [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    expect(panels).toHaveLength(6);
    for (const tab of tabs) {
      const panelId = tab.getAttribute("aria-controls");
      expect(panelId).not.toBeNull();
      const panel = document.getElementById(panelId ?? "");
      expect(panel).not.toBeNull();
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
    }

    const registryTab = screen.getByRole("tab", { name: "Реестр" });
    const setupTab = screen.getByRole("tab", { name: "Настройка" });
    const registryPanel = document.getElementById(registryTab.getAttribute("aria-controls") ?? "");
    const setupPanel = document.getElementById(setupTab.getAttribute("aria-controls") ?? "");
    expect(registryTab.getAttribute("aria-selected")).toBe("true");
    expect(setupTab.getAttribute("aria-selected")).toBe("false");
    expect(registryPanel?.hidden).toBe(false);
    expect(setupPanel?.hidden).toBe(true);
    expect(screen.queryByRole("heading", { name: "ChatGPT Accounts" })).toBeNull();

    await user.click(setupTab);
    expect(setupTab.getAttribute("aria-selected")).toBe("true");
    expect(setupPanel?.hidden).toBe(false);
    expect(registryPanel?.hidden).toBe(true);
    expect(screen.getByRole("heading", { name: "ChatGPT Accounts" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Новая Mission" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Новый Agent" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Канонические модели" })).toBeNull();

    setupTab.focus();
    await user.keyboard("{ArrowRight}");
    const runtimeTab = screen.getByRole("tab", { name: "Runtime" });
    expect(document.activeElement).toBe(runtimeTab);
    expect(runtimeTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Интеграции" })).not.toBeNull();

    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(setupTab);
    expect(setupTab.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{End}");
    const routingTab = screen.getByRole("tab", { name: "Маршруты" });
    expect(document.activeElement).toBe(routingTab);
    expect(routingTab.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(registryTab);
    expect(registryTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Канонические модели" })).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("preserves visited section drafts and lazily mounts Runtime only once", async () => {
    const user = userEvent.setup();
    const load = vi.fn(async () => fixture);
    const operationsLoad = vi.fn(async () => operationsFixture);
    render(
      <HubPanel
        load={load}
        onSelectAgent={vi.fn()}
        operationsLoad={operationsLoad}
        csrfToken="csrf"
      />,
    );

    await screen.findByRole("heading", { name: "Canonical Hub" });
    expect(operationsLoad).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Operations" })).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Настройка" }));
    const titleInput = screen.getByLabelText("Название Mission") as HTMLInputElement;
    const goalInput = screen.getByLabelText("Цель") as HTMLTextAreaElement;
    await user.type(titleInput, "Audit release readiness");
    await user.type(goalInput, "Keep the operator flow intact");

    await user.click(screen.getByRole("tab", { name: "Runtime" }));
    const operationsHeading = await screen.findByRole("heading", { name: "Operations" });
    await waitFor(() => expect(operationsLoad).toHaveBeenCalledTimes(1));
    const operationsSection = operationsHeading.closest("section");
    expect(operationsSection).not.toBeNull();
    await user.click(
      within(operationsSection as HTMLElement).getByRole("button", { name: "Advanced" }),
    );
    expect(
      within(operationsSection as HTMLElement).getByRole("button", { name: "Simple" }),
    ).not.toBeNull();

    await user.click(screen.getByRole("tab", { name: "Реестр" }));
    expect(operationsSection?.closest('[role="tabpanel"]')?.hasAttribute("hidden")).toBe(true);
    await user.click(screen.getByRole("tab", { name: "Runtime" }));
    expect(operationsLoad).toHaveBeenCalledTimes(1);
    expect(
      within(operationsSection as HTMLElement).getByRole("button", { name: "Simple" }),
    ).not.toBeNull();

    await user.click(screen.getByRole("tab", { name: "Настройка" }));
    expect(titleInput.value).toBe("Audit release readiness");
    expect(goalInput.value).toBe("Keep the operator flow intact");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("moves Agent provisioning into Automation and keeps the created Agent selected", async () => {
    const user = userEvent.setup();
    let createdAgentId = "";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as { commandId: string; agentId: string };
      createdAgentId = command.agentId;
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          outcome: "CREATED",
          commandId: command.commandId,
          resource: { kind: "AGENT", id: command.agentId },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const load = vi.fn(async (attempt: number) => {
      if (attempt === 0 || !createdAgentId) return fixture;
      return HubReadModelSchema.parse({
        ...fixture,
        agents: [
          ...fixture.agents,
          {
            agentId: createdAgentId,
            slug: "new-agent",
            displayName: "New Agent",
            role: "Scheduled operator",
            isEnabled: true,
            skillAssignments: [],
            toolAssignments: [],
          },
        ],
        projects: fixture.projects.map((project) => ({
          ...project,
          agentIds: [...project.agentIds, createdAgentId],
        })),
      });
    });
    const nativeChatProfileClient = {
      load: vi.fn(async () => ({ schemaVersion: 1 as const, profiles: [] })),
      save: vi.fn(),
    };
    const scheduleClient = {
      load: vi.fn(async () => []),
      create: vi.fn(),
    };

    render(
      <HubPanel
        csrfToken="csrf"
        load={load}
        nativeChatProfileClient={nativeChatProfileClient}
        onSelectAgent={vi.fn()}
        scheduleClient={scheduleClient}
      />,
    );
    await screen.findByRole("heading", { name: "Canonical Hub" });
    await user.click(screen.getByRole("tab", { name: "Настройка" }));
    await user.type(screen.getByLabelText("Имя Agent"), "New Agent");
    await user.type(screen.getByLabelText("Slug"), "new-agent");
    await user.type(screen.getByLabelText("Роль"), "Scheduled operator");
    await user.type(screen.getByLabelText("Instructions"), "Run the scheduled workflow.");
    await user.click(screen.getByRole("button", { name: "Создать Agent" }));
    const scheduleButton = await screen.findByRole("button", { name: "Настроить расписание" });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    await user.click(scheduleButton);
    const automationTab = screen.getByRole("tab", { name: "Автоматизация" });
    expect(automationTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(automationTab);
    await waitFor(() => {
      expect((screen.getByLabelText("Agent") as HTMLSelectElement).value).toBe(createdAgentId);
    });
    expect(scheduleClient.load).toHaveBeenCalledTimes(1);
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
