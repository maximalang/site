// @vitest-environment jsdom

import type { HubReadModel } from "@agent-world/read-model";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelRouteCheckPanel } from "./model-route-check-panel";

vi.mock("../client/model-route-check-api", () => ({
  checkModelRoute: vi.fn(async () => ({
    schemaVersion: 1,
    runId: "run_11111111-1111-1111-1111-111111111111",
    modelRouteId: "model_route_22222222-2222-2222-2222-222222222222",
    providerId: "provider_33333333-3333-3333-3333-333333333333",
    accountId: "account_44444444-4444-4444-4444-444444444444",
    mode: "API",
    remoteModelId: "gpt-5-mini",
    status: "SUCCEEDED",
    usage: { inputTokens: 6, outputTokens: 1, totalTokens: 7 },
  })),
}));

const model = {
  models: [
    {
      routes: [
        {
          modelRouteId: "model_route_22222222-2222-2222-2222-222222222222",
          remoteModelId: "gpt-5-mini",
          surface: "API",
          isEnabled: true,
        },
      ],
    },
  ],
} as HubReadModel;

describe("ModelRouteCheckPanel", () => {
  it("shows Account/API/Model/Mode and measured token provenance after execution", async () => {
    render(<ModelRouteCheckPanel csrfToken="csrf" model={model} />);
    await userEvent.click(screen.getByRole("button", { name: "Проверить" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("API");
    expect(status.textContent).toContain("provider_33333333");
    expect(status.textContent).toContain("account_44444444");
    expect(status.textContent).toContain("gpt-5-mini");
    expect(status.textContent).toContain("7 tokens");
  });
});
