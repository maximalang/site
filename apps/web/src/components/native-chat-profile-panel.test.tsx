// @vitest-environment jsdom

import {
  NativeChatBrowserProfileConfigurationSchema,
  NativeChatBrowserProfileListSchema,
} from "@agent-world/domain";
import { HubReadModelSchema } from "@agent-world/read-model";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeChatProfilePanel } from "./native-chat-profile-panel";

const accountId = "account_11111111-1111-1111-1111-111111111111";
const hub = HubReadModelSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-14T10:00:00.000Z",
  providers: [],
  accounts: [
    {
      accountId,
      providerId: "provider_22222222-2222-2222-2222-222222222222",
      label: "Plus primary",
      authMechanism: "CHATGPT_INTERACTIVE",
      subscription: "Plus",
      availableSurfaces: ["CHAT"],
      health: "ACTIVE",
      isEnabled: true,
      createdAt: "2026-08-14T09:00:00.000Z",
    },
  ],
  models: [],
  executionRoutes: [],
  agents: [],
  skills: [],
  tools: [],
  projects: [],
});
const empty = NativeChatBrowserProfileListSchema.parse({ schemaVersion: 1, profiles: [] });

afterEach(cleanup);

describe("NativeChatProfilePanel", () => {
  it("keeps profile alias automatic in Simple mode and saves the App URL", async () => {
    const user = userEvent.setup();
    const configured = NativeChatBrowserProfileConfigurationSchema.parse({
      schemaVersion: 1,
      accountId,
      profileRef: "plus-1",
      launchUrl: "https://chatgpt.com/g/ai-world-agent",
      isEnabled: true,
      updatedAt: "2026-08-14T10:01:00.000Z",
    });
    const save = vi.fn(async () => configured);
    render(
      <NativeChatProfilePanel
        client={{ load: async () => empty, save }}
        csrfToken="csrf-value"
        hub={hub}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Native Plus Chat" })).not.toBeNull();
    expect(screen.queryByLabelText("Browser profile alias")).toBeNull();
    await user.type(screen.getByLabelText("AI World App URL"), configured.launchUrl);
    await user.click(screen.getByRole("button", { name: "Сохранить подключение" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        {
          schemaVersion: 1,
          accountId,
          profileRef: "plus-1",
          launchUrl: configured.launchUrl,
          isEnabled: true,
        },
        "csrf-value",
      ),
    );
    expect(await screen.findByText("Подключение сохранено")).not.toBeNull();
  });

  it("reveals the opaque alias and enabled toggle only in Advanced mode", async () => {
    const user = userEvent.setup();
    render(
      <NativeChatProfilePanel
        client={{ load: async () => empty, save: vi.fn() }}
        csrfToken="csrf-value"
        hub={hub}
      />,
    );
    await screen.findByRole("heading", { name: "Native Plus Chat" });
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByLabelText("Browser profile alias")).not.toBeNull();
    expect(screen.getByLabelText("Launcher enabled")).not.toBeNull();
  });
});
