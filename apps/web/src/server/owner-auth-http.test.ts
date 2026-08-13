import { describe, expect, it, vi } from "vitest";
import { createOwnerAuthHttpHandlers } from "./owner-auth-http";

const authState = {
  csrfToken: "csrf-token",
  expiresAt: "2026-08-13T22:00:00.000Z",
};

function auth() {
  return {
    login: vi.fn(async () => ({
      kind: "AUTHENTICATED" as const,
      cookie: "__Host-agent_world_session=opaque; Path=/; HttpOnly; Secure; SameSite=Strict",
      ...authState,
    })),
    session: vi.fn(async () => authState),
    logout: vi.fn(
      async () =>
        "__Host-agent_world_session=; Path=/; HttpOnly; Secure; Max-Age=0" as string | undefined,
    ),
  };
}

function request(path: string, init: RequestInit = {}, origin = "https://world.test"): Request {
  const headers = new Headers(init.headers);
  if (init.method === "POST" && !headers.has("origin")) {
    headers.set("origin", origin);
  }
  return new Request(`https://world.test${path}`, { ...init, headers });
}

describe("owner auth HTTP handlers", () => {
  it("sets one secure cookie and returns refreshable CSRF state after login", async () => {
    const service = auth();
    const response = await createOwnerAuthHttpHandlers(service).login(
      request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ schemaVersion: 1, password: "owner-password" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      authenticated: true,
      ...authState,
    });
    expect(service.login).toHaveBeenCalledWith("owner-password");
  });

  it("rejects cross-origin, broad, malformed and oversized login bodies before auth", async () => {
    const cases = [
      request(
        "/api/auth/login",
        {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://evil.test" },
          body: JSON.stringify({ schemaVersion: 1, password: "owner-password" }),
        },
        "https://evil.test",
      ),
      request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "owner-password",
      }),
      request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, password: "owner-password", admin: true }),
      }),
      request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, password: "x".repeat(1_025) }),
      }),
    ];

    for (const input of cases) {
      const service = auth();
      const response = await createOwnerAuthHttpHandlers(service).login(input);
      expect(response.status).toBe(400);
      expect(service.login).not.toHaveBeenCalled();
    }
  });

  it("maps invalid, throttled and provider failures to bounded responses", async () => {
    const cases = [
      { result: { kind: "REJECTED" as const, code: "INVALID_CREDENTIALS" as const }, status: 401 },
      { result: { kind: "REJECTED" as const, code: "THROTTLED" as const }, status: 429 },
      { result: { kind: "REJECTED" as const, code: "UNAVAILABLE" as const }, status: 503 },
    ];
    for (const testCase of cases) {
      const service = auth();
      service.login.mockResolvedValue(testCase.result as never);
      const response = await createOwnerAuthHttpHandlers(service).login(
        request("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ schemaVersion: 1, password: "owner-password" }),
        }),
      );
      expect(response.status).toBe(testCase.status);
      expect(await response.text()).not.toMatch(/owner-password|postgres|secret/);
    }
  });

  it("returns session state without a new cookie and clears a revoked session", async () => {
    const service = auth();
    const handlers = createOwnerAuthHttpHandlers(service);
    const session = await handlers.session(request("/api/auth/session"));
    const logout = await handlers.logout(request("/api/auth/logout", { method: "POST" }));

    expect(session.status).toBe(200);
    expect(session.headers.get("set-cookie")).toBeNull();
    expect(await session.json()).toMatchObject({ authenticated: true, ...authState });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("fails closed when session or logout authorization is absent", async () => {
    const service = auth();
    service.session.mockResolvedValue(undefined as never);
    service.logout.mockResolvedValue(undefined);
    const handlers = createOwnerAuthHttpHandlers(service);

    expect((await handlers.session(request("/api/auth/session"))).status).toBe(401);
    expect((await handlers.logout(request("/api/auth/logout", { method: "POST" }))).status).toBe(
      401,
    );
  });
});
