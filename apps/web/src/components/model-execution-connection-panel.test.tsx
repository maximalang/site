// @vitest-environment jsdom

import type { HubReadModel } from "@agent-world/read-model";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelExecutionConnectionPanel } from "./model-execution-connection-panel";

afterEach(cleanup);

const model = {
  models: [
    {
      displayName: "GPT-X",
      routes: [
        {
          modelRouteId: "model_route_11111111-1111-4111-8111-111111111111",
          remoteModelId: "gpt-x",
          surface: "API",
          availability: "AVAILABLE",
          isEnabled: true,
        },
      ],
    },
  ],
  projects: [
    {
      projectId: "project_22222222-2222-4222-8222-222222222222",
      name: "AI World",
      agentIds: ["agent_33333333-3333-4333-8333-333333333333"],
    },
  ],
  agents: [
    {
      agentId: "agent_33333333-3333-4333-8333-333333333333",
      displayName: "Researcher",
    },
  ],
} as HubReadModel;

describe("ModelExecutionConnectionPanel", () => {
  it("creates one atomic Auto-selected model execution connection", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const onProvisioned = vi.fn();
    render(
      <ModelExecutionConnectionPanel
        client={{ execute }}
        csrfToken="csrf"
        model={model}
        onProvisioned={onProvisioned}
      />,
    );
    expect(screen.getByText("Выполнение: AUTO · GPT-X")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Подключить" }));
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "MODEL_AGENT_ROUTE_PROVISION",
        modelRouteId: "model_route_11111111-1111-4111-8111-111111111111",
        agentId: "agent_33333333-3333-4333-8333-333333333333",
        projectId: "project_22222222-2222-4222-8222-222222222222",
      }),
      "csrf",
    );
    expect(await screen.findByText("Маршрут и сессия агента подключены")).toBeTruthy();
    expect(onProvisioned).toHaveBeenCalledOnce();
  });
});
