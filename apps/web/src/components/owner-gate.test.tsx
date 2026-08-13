// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationApiError, type OwnerSession } from "../client/auth-api";
import { OwnerGate } from "./owner-gate";

const session: OwnerSession = {
  schemaVersion: 1,
  authenticated: true,
  csrfToken: "a".repeat(43),
  expiresAt: "2026-08-13T22:00:00.000Z",
};

vi.mock("./control-center", () => ({
  ControlCenter: ({ csrfToken }: { csrfToken: string }) => <main>Control {csrfToken}</main>,
}));

afterEach(cleanup);

describe("OwnerGate", () => {
  it("shows a bounded login gate and clears the password after authentication", async () => {
    const user = userEvent.setup();
    const login = vi.fn(async () => session);
    render(
      <OwnerGate
        auth={{
          loadSession: async () => {
            throw new AuthenticationApiError(401, "AUTHENTICATION_REQUIRED");
          },
          login,
          logout: vi.fn(),
        }}
      />,
    );
    const password = await screen.findByLabelText("Пароль владельца");
    await user.type(password, "owner-password");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByText(`Control ${session.csrfToken}`)).not.toBeNull();
    expect(login).toHaveBeenCalledWith("owner-password");
    expect(screen.queryByDisplayValue("owner-password")).toBeNull();
  });

  it("does not present an unavailable auth backend as invalid credentials", async () => {
    render(
      <OwnerGate
        auth={{
          loadSession: async () => {
            throw new AuthenticationApiError(503, "AUTHENTICATION_UNAVAILABLE");
          },
          login: vi.fn(),
          logout: vi.fn(),
        }}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Контур входа недоступен");
  });
});
