// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatGptAccountPanel } from "./chatgpt-account-panel";

afterEach(cleanup);

describe("ChatGptAccountPanel", () => {
  it("creates a canonical ChatGPT Account separately from Agents", async () => {
    const user = userEvent.setup();
    const execute = vi.fn().mockResolvedValue(undefined);
    const onCreated = vi.fn();
    render(
      <ChatGptAccountPanel
        accounts={[]}
        providers={[]}
        csrfToken="csrf"
        client={{ execute }}
        onCreated={onCreated}
      />,
    );
    await user.type(screen.getByLabelText("Название аккаунта"), "Plus primary");
    await user.click(screen.getByLabelText("Разрешить поверхность Codex"));
    await user.click(screen.getByRole("button", { name: "Добавить аккаунт ChatGPT" }));
    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "PROVIDER_CREATE", category: "CONSUMER_ACCOUNT" }),
      "csrf",
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: "ACCOUNT_CREATE",
        authMechanism: "CHATGPT_INTERACTIVE",
        subscription: "Plus",
        availableSurfaces: ["CHAT", "CODEX"],
      }),
      "csrf",
    );
    expect(execute.mock.calls[1]?.[0]).not.toHaveProperty("agentId");
    expect(onCreated).toHaveBeenCalledWith(expect.stringMatching(/^account_/));
    expect(await screen.findByText("Аккаунт добавлен; требуется вход")).not.toBeNull();
  });
});
