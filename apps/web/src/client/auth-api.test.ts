import { describe, expect, it, vi } from "vitest";
import { loadOwnerSession, loginOwner, logoutOwner } from "./auth-api";

const session = {
  schemaVersion: 1 as const,
  authenticated: true as const,
  csrfToken: "a".repeat(43),
  expiresAt: "2026-08-13T22:00:00.000Z",
};

describe("owner auth client", () => {
  it("keeps credentials same-origin and validates the session", async () => {
    const fetcher = vi.fn(async () => Response.json(session));
    await expect(loadOwnerSession(fetcher)).resolves.toEqual(session);
    expect(fetcher).toHaveBeenCalledWith("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
    });
  });

  it("posts only the bounded login contract", async () => {
    const fetcher = vi.fn(async () => Response.json(session));
    await loginOwner("secret", fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/auth/login", {
      body: JSON.stringify({ schemaVersion: 1, password: "secret" }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("sends CSRF only in the logout header and rejects malformed success bodies", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    await logoutOwner(session.csrfToken, fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/auth/logout", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "X-Agent-World-CSRF": session.csrfToken },
      method: "POST",
    });
    await expect(
      loadOwnerSession(async () => Response.json({ authenticated: true })),
    ).rejects.toThrow("Invalid authentication response");
  });
});
