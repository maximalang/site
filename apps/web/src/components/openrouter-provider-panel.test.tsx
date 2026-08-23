// @vitest-environment jsdom

import type { HubReadModel } from "@agent-world/read-model";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenRouterProviderPanel } from "./openrouter-provider-panel";

afterEach(cleanup);

const hub = {
  providers: [],
  accounts: [],
  models: [
    {
      modelId: "model_11111111-1111-4111-8111-111111111111",
      displayName: "Claude canonical",
      isEnabled: true,
      capabilities: {
        reasoning: true,
        toolUse: true,
        modalities: ["TEXT"],
        contextWindowTokens: 200_000,
      },
      routes: [],
    },
  ],
} as unknown as HubReadModel;

describe("OpenRouterProviderPanel", () => {
  it("creates Provider, API account and canonical ModelRoute through generic commands", async () => {
    const user = userEvent.setup();
    const execute = vi.fn().mockResolvedValue(undefined);
    const onCreated = vi.fn();
    render(
      <OpenRouterProviderPanel
        client={{ execute }}
        csrfToken="csrf"
        hub={hub}
        onCreated={onCreated}
      />,
    );

    await user.clear(screen.getByLabelText("Название API account"));
    await user.type(screen.getByLabelText("Название API account"), "OpenRouter primary");
    await user.type(screen.getByLabelText("OpenRouter model ID"), "anthropic/test-model");
    await user.click(screen.getByRole("button", { name: "Создать OpenRouter route" }));

    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "PROVIDER_CREATE",
        slug: "openrouter",
        displayName: "OpenRouter",
        providerKind: "OPENROUTER",
        category: "LLM_API",
        baseUrl: "https://openrouter.ai/api/v1",
      }),
      "csrf",
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: "ACCOUNT_CREATE",
        label: "OpenRouter primary",
        authMechanism: "API_KEY",
        availableSurfaces: ["API"],
      }),
      "csrf",
    );
    expect(execute).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        kind: "MODEL_ROUTE_CREATE",
        canonicalModelId: "model_11111111-1111-4111-8111-111111111111",
        surface: "API",
        remoteModelId: "anthropic/test-model",
        availability: "AVAILABLE",
        contextWindowTokens: 200_000,
        supportedModalities: ["TEXT"],
      }),
      "csrf",
    );
    expect(onCreated).toHaveBeenCalledWith({
      accountId: expect.stringMatching(/^account_/),
      modelRouteId: expect.stringMatching(/^model_route_/),
    });
    expect(await screen.findByText(/OpenRouter route создан/)).toBeTruthy();
  });

  it("rejects model IDs without the OpenRouter provider/model shape", async () => {
    const user = userEvent.setup();
    const execute = vi.fn();
    render(<OpenRouterProviderPanel client={{ execute }} csrfToken="csrf" hub={hub} />);
    await user.type(screen.getByLabelText("OpenRouter model ID"), "model-without-provider");
    const button = screen.getByRole("button", { name: "Создать OpenRouter route" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("provider/model");
    expect(execute).not.toHaveBeenCalled();
  });
});
