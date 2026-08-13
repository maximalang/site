// @vitest-environment jsdom

import {
  ExecutionPreferenceLayerSchema,
  ExecutionPreferenceReadModelSchema,
  HubReadModelSchema,
  resolveExecutionPreferences,
} from "@agent-world/read-model";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionPreferencesPanel } from "./execution-preferences-panel";

const projectId = "project_11111111-1111-1111-1111-111111111111";
const agentId = "agent_22222222-2222-2222-2222-222222222222";
const hub = HubReadModelSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-13T12:00:00.000Z",
  providers: [],
  accounts: [],
  models: [],
  executionRoutes: [],
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
  skills: [],
  tools: [],
  projects: [
    {
      projectId,
      slug: "control-center",
      name: "Control Center",
      isArchived: false,
      createdAt: "2026-08-13T12:00:00.000Z",
      agentIds: [agentId],
    },
  ],
});
const system = ExecutionPreferenceLayerSchema.parse({
  schemaVersion: 1,
  scope: { kind: "SYSTEM" },
  overrides: {
    model: { kind: "AUTO" },
    account: { kind: "AUTO" },
    mode: "AUTO",
    context: "BALANCED",
    budget: "BALANCED",
  },
});
const project = ExecutionPreferenceLayerSchema.parse({
  schemaVersion: 1,
  scope: { kind: "PROJECT", projectId },
  overrides: { budget: "QUALITY" },
});
const agent = ExecutionPreferenceLayerSchema.parse({
  schemaVersion: 1,
  scope: { kind: "AGENT", agentId },
  overrides: { mode: "CODEX" },
});
const systemModel = ExecutionPreferenceReadModelSchema.parse({
  schemaVersion: 1,
  selection: {},
  local: system,
  resolved: resolveExecutionPreferences([system]),
});
const agentModel = ExecutionPreferenceReadModelSchema.parse({
  schemaVersion: 1,
  selection: { projectId, agentId },
  local: agent,
  resolved: resolveExecutionPreferences([system, project, agent]),
});

afterEach(cleanup);

describe("ExecutionPreferencesPanel", () => {
  it("shows effective provenance and resets one local override without copying inherited values", async () => {
    const user = userEvent.setup();
    const write = vi.fn(async () => undefined);
    const load = vi.fn(async (selection: { agentId?: unknown }) =>
      selection.agentId ? agentModel : systemModel,
    );
    render(<ExecutionPreferencesPanel client={{ load, write }} csrfToken="csrf-token" hub={hub} />);
    expect(await screen.findAllByText("Источник: System Defaults")).toHaveLength(5);
    await user.selectOptions(screen.getByLabelText("Уровень"), "AGENT");
    expect(await screen.findByText("Inherited from Project")).not.toBeNull();
    const mode = screen.getByText("Mode").closest(".preference-field");
    expect(mode).not.toBeNull();
    expect(within(mode as HTMLElement).getByText("Override at Agent")).not.toBeNull();
    await user.click(
      within(mode as HTMLElement).getByRole("button", { name: "Reset to inherited" }),
    );
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith({
      csrfToken: "csrf-token",
      layer: {
        schemaVersion: 1,
        scope: agent.scope,
        overrides: {},
      },
    });
  });

  it("keeps reset unavailable at the required System layer", async () => {
    render(
      <ExecutionPreferencesPanel
        client={{ load: async () => systemModel, write: vi.fn() }}
        csrfToken="csrf-token"
        hub={hub}
      />,
    );
    await screen.findAllByText("Источник: System Defaults");
    expect(
      screen
        .getAllByRole("button", { name: "Reset to inherited" })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
  });
});
