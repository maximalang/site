import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { OwnerSessionManager } from "./owner-session";

const TOKEN = Buffer.alloc(32, 1).toString("base64url");
const TOKEN_HASH = createHash("sha256").update(TOKEN, "ascii").digest("hex");
const SECRET = Buffer.alloc(32, 2).toString("base64url");
const NOW = "2026-08-13T10:00:00.000Z";

function store() {
  return {
    claimLoginAttempt: vi.fn<() => Promise<"ALLOWED" | "BLOCKED">>(async () => "ALLOWED"),
    resetLoginThrottle: vi.fn(async () => undefined),
    createSession: vi.fn(async () => undefined),
    resolveSession: vi.fn(async () => ({ expiresAt: "2026-08-13T22:00:00.000Z" })),
    revokeSession: vi.fn(async () => undefined),
  };
}

function manager(overrides: Record<string, unknown> = {}) {
  const sessionStore = store();
  const value = new OwnerSessionManager({
    store: sessionStore,
    passwordHash: "configured-hash",
    csrfSecret: SECRET,
    now: () => new Date(NOW),
    random: () => Buffer.alloc(32, 1),
    verifyPassword: async (password) => password === "valid-password-input",
    ...overrides,
  });
  return { value, sessionStore };
}

function request(
  method: string,
  options: { cookie?: string; csrf?: string; origin?: string; fetchSite?: string } = {},
) {
  return new Request("https://world.test/api/conversations/example", {
    method,
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.csrf ? { "x-agent-world-csrf": options.csrf } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.fetchSite ? { "sec-fetch-site": options.fetchSite } : {}),
    },
  });
}

describe("OwnerSessionManager", () => {
  it("creates an opaque secure session and persists only its digest", async () => {
    const { value, sessionStore } = manager();
    const result = await value.login("valid-password-input");

    expect(result.kind).toBe("AUTHENTICATED");
    if (result.kind !== "AUTHENTICATED") return;
    expect(result.cookie).toContain(`__Host-agent_world_session=${TOKEN}`);
    expect(result.cookie).toContain("HttpOnly; Secure; SameSite=Strict; Priority=High");
    expect(result.cookie).not.toContain(result.csrfToken);
    expect(sessionStore.createSession).toHaveBeenCalledWith({
      tokenHash: TOKEN_HASH,
      createdAt: NOW,
      expiresAt: "2026-08-13T22:00:00.000Z",
    });
    expect(JSON.stringify(sessionStore.createSession.mock.calls)).not.toContain(TOKEN);
  });

  it("rejects invalid credentials, throttle and incomplete cryptographic configuration", async () => {
    const invalid = manager();
    await expect(invalid.value.login("wrong-password")).resolves.toEqual({
      kind: "REJECTED",
      code: "INVALID_CREDENTIALS",
    });
    expect(invalid.sessionStore.createSession).not.toHaveBeenCalled();

    const blockedStore = store();
    blockedStore.claimLoginAttempt.mockResolvedValue("BLOCKED");
    await expect(
      manager({ store: blockedStore }).value.login("valid-password-input"),
    ).resolves.toEqual({ kind: "REJECTED", code: "THROTTLED" });
    await expect(
      manager({ csrfSecret: "invalid" }).value.login("valid-password-input"),
    ).resolves.toEqual({ kind: "REJECTED", code: "UNAVAILABLE" });
  });

  it("authorizes reads with one active cookie and mutations only with same-origin CSRF", async () => {
    const { value } = manager();
    const login = await value.login("valid-password-input");
    if (login.kind !== "AUTHENTICATED") throw new Error("fixture login failed");
    const cookie = `${value.cookieName}=${TOKEN}`;

    await expect(value.authorize(request("GET", { cookie }))).resolves.toBe(true);
    await expect(
      value.authorize(
        request("POST", {
          cookie,
          csrf: login.csrfToken,
          origin: "https://world.test",
          fetchSite: "same-origin",
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      value.authorize(
        request("POST", { cookie, csrf: login.csrfToken, origin: "https://evil.test" }),
      ),
    ).resolves.toBe(false);
    await expect(
      value.authorize(request("POST", { cookie, origin: "https://world.test" })),
    ).resolves.toBe(false);
    await expect(
      value.authorize(
        request("POST", {
          cookie,
          csrf: "not-a-canonical-csrf-token",
          origin: "https://world.test",
        }),
      ),
    ).resolves.toBe(false);
  });

  it("rejects missing, malformed and duplicate session cookies before store lookup", async () => {
    const { value, sessionStore } = manager();
    await expect(value.authorize(request("GET"))).resolves.toBe(false);
    await expect(
      value.authorize(request("GET", { cookie: `${value.cookieName}=raw-secret` })),
    ).resolves.toBe(false);
    await expect(
      value.authorize(
        request("GET", {
          cookie: `${value.cookieName}=${TOKEN}; ${value.cookieName}=${TOKEN}`,
        }),
      ),
    ).resolves.toBe(false);
    expect(sessionStore.resolveSession).not.toHaveBeenCalled();
  });

  it("returns refreshable CSRF state and revokes the hashed session on logout", async () => {
    const { value, sessionStore } = manager();
    const login = await value.login("valid-password-input");
    if (login.kind !== "AUTHENTICATED") throw new Error("fixture login failed");
    const cookie = `${value.cookieName}=${TOKEN}`;
    await expect(value.session(request("GET", { cookie }))).resolves.toEqual({
      csrfToken: login.csrfToken,
      expiresAt: "2026-08-13T22:00:00.000Z",
    });
    const cleared = await value.logout(
      request("POST", {
        cookie,
        csrf: login.csrfToken,
        origin: "https://world.test",
      }),
    );
    expect(cleared).toContain(`${value.cookieName}=;`);
    expect(cleared).toContain("Max-Age=0");
    expect(sessionStore.revokeSession).toHaveBeenCalledWith(TOKEN_HASH, NOW);
  });
});
