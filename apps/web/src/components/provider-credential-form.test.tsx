import type { HubReadModel } from "@agent-world/read-model";
// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProviderCredentialForm } from "./provider-credential-form";

vi.mock("../client/provider-credential-api", () => ({
  writeProviderCredential: vi.fn(async () => undefined),
}));

const model = {
  accounts: [
    {
      accountId: "account_33333333-3333-3333-3333-333333333333",
      providerId: "provider_11111111-1111-1111-1111-111111111111",
      label: "OpenAI API",
      authMechanism: "API_KEY",
      availableSurfaces: ["API"],
      health: "UNCONFIGURED",
      isEnabled: true,
      createdAt: "2026-08-13T12:00:00.000Z",
    },
  ],
} as HubReadModel;

describe("ProviderCredentialForm", () => {
  it("clears the key after a successful write and never renders it again", async () => {
    render(<ProviderCredentialForm csrfToken="csrf" model={model} />);
    const input = screen.getByLabelText("API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "provider-super-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить ключ" }));
    await screen.findByRole("status");
    expect(input.value).toBe("");
    expect(document.body.textContent).not.toContain("provider-super-secret");
  });

  it("does not render a credential form without an eligible API-key Account", async () => {
    const { container } = render(
      <ProviderCredentialForm csrfToken="csrf" model={{ ...model, accounts: [] }} />,
    );
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
