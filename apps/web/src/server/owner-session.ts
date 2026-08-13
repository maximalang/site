import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PostgresOwnerSessionStore } from "@agent-world/postgres-store";
import { verifyOwnerPassword } from "./owner-password";

const PRODUCTION_COOKIE_NAME = "__Host-agent_world_session";
const DEVELOPMENT_COOKIE_NAME = "agent_world_session";
const CSRF_HEADER = "x-agent-world-csrf";
const SESSION_BYTES = 32;
const SESSION_DURATION_MILLISECONDS = 12 * 60 * 60 * 1_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type OwnerSessionStore = Pick<
  PostgresOwnerSessionStore,
  "claimLoginAttempt" | "resetLoginThrottle" | "createSession" | "resolveSession" | "revokeSession"
>;

export type OwnerLoginResult =
  | {
      kind: "AUTHENTICATED";
      cookie: string;
      csrfToken: string;
      expiresAt: string;
    }
  | { kind: "REJECTED"; code: "INVALID_CREDENTIALS" | "THROTTLED" | "UNAVAILABLE" };

export type OwnerSessionResult = {
  csrfToken: string;
  expiresAt: string;
};

export type OwnerSessionManagerOptions = {
  store: OwnerSessionStore;
  passwordHash: string | undefined;
  csrfSecret: string | undefined;
  secureCookies?: boolean;
  now?: () => Date;
  random?: (size: number) => Buffer;
  verifyPassword?: (password: string, configuredHash: string | undefined) => Promise<boolean>;
};

function parseSecret(input: string | undefined): Buffer | undefined {
  if (!input || !/^[A-Za-z0-9_-]{43}$/.test(input)) {
    return undefined;
  }
  const decoded = Buffer.from(input, "base64url");
  return decoded.length === 32 && decoded.toString("base64url") === input ? decoded : undefined;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "ascii").digest("hex");
}

function csrfToken(secret: Buffer, token: string): string {
  return createHmac("sha256", secret).update(`owner-session:${token}`, "ascii").digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "ascii").digest();
  const rightDigest = createHash("sha256").update(right, "ascii").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function parseSessionCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header || Buffer.byteLength(header, "utf8") > 8_192) {
    return undefined;
  }
  const values = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  if (values.length !== 1 || !values[0] || !TOKEN_PATTERN.test(values[0])) {
    return undefined;
  }
  return values[0];
}

function safeMutationOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    origin === new URL(request.url).origin && (fetchSite === null || fetchSite === "same-origin")
  );
}

export class OwnerSessionManager {
  private readonly store: OwnerSessionStore;
  private readonly passwordHash: string | undefined;
  private readonly secret: Buffer | undefined;
  private readonly secureCookies: boolean;
  private readonly now: () => Date;
  private readonly random: (size: number) => Buffer;
  private readonly verifyPassword: NonNullable<OwnerSessionManagerOptions["verifyPassword"]>;

  constructor(options: OwnerSessionManagerOptions) {
    this.store = options.store;
    this.passwordHash = options.passwordHash;
    this.secret = parseSecret(options.csrfSecret);
    this.secureCookies = options.secureCookies ?? true;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? randomBytes;
    this.verifyPassword = options.verifyPassword ?? verifyOwnerPassword;
  }

  get cookieName(): string {
    return this.secureCookies ? PRODUCTION_COOKIE_NAME : DEVELOPMENT_COOKIE_NAME;
  }

  async login(password: string): Promise<OwnerLoginResult> {
    const now = this.safeNow();
    if (!now || !this.secret) {
      return { kind: "REJECTED", code: "UNAVAILABLE" };
    }
    try {
      if ((await this.store.claimLoginAttempt(now)) !== "ALLOWED") {
        return { kind: "REJECTED", code: "THROTTLED" };
      }
    } catch {
      return { kind: "REJECTED", code: "UNAVAILABLE" };
    }

    let verified = false;
    try {
      verified = await this.verifyPassword(password, this.passwordHash);
    } catch {
      return { kind: "REJECTED", code: "UNAVAILABLE" };
    }
    if (!verified) {
      return { kind: "REJECTED", code: "INVALID_CREDENTIALS" };
    }

    const tokenBytes = this.random(SESSION_BYTES);
    if (tokenBytes.length !== SESSION_BYTES) {
      return { kind: "REJECTED", code: "UNAVAILABLE" };
    }
    const token = tokenBytes.toString("base64url");
    const expiresAt = new Date(Date.parse(now) + SESSION_DURATION_MILLISECONDS).toISOString();
    try {
      await this.store.resetLoginThrottle(now);
      await this.store.createSession({ tokenHash: tokenHash(token), createdAt: now, expiresAt });
    } catch {
      return { kind: "REJECTED", code: "UNAVAILABLE" };
    }

    return {
      kind: "AUTHENTICATED",
      cookie: this.serializeCookie(token, expiresAt),
      csrfToken: csrfToken(this.secret, token),
      expiresAt,
    };
  }

  async session(request: Request): Promise<OwnerSessionResult | undefined> {
    const resolved = await this.resolve(request);
    return resolved ? { csrfToken: resolved.csrfToken, expiresAt: resolved.expiresAt } : undefined;
  }

  async authorize(request: Request): Promise<boolean> {
    const resolved = await this.resolve(request);
    if (!resolved) {
      return false;
    }
    if (request.method === "GET" || request.method === "HEAD") {
      return true;
    }
    const supplied = request.headers.get(CSRF_HEADER);
    return (
      safeMutationOrigin(request) &&
      supplied !== null &&
      TOKEN_PATTERN.test(supplied) &&
      constantTimeEqual(supplied, resolved.csrfToken)
    );
  }

  async logout(request: Request): Promise<string | undefined> {
    if (!(await this.authorize(request))) {
      return undefined;
    }
    const token = parseSessionCookie(request, this.cookieName);
    const now = this.safeNow();
    if (!token || !now) {
      return undefined;
    }
    try {
      await this.store.revokeSession(tokenHash(token), now);
    } catch {
      return undefined;
    }
    return this.clearCookie();
  }

  private async resolve(
    request: Request,
  ): Promise<(OwnerSessionResult & { token: string }) | undefined> {
    const token = parseSessionCookie(request, this.cookieName);
    const now = this.safeNow();
    if (!token || !now || !this.secret) {
      return undefined;
    }
    try {
      const record = await this.store.resolveSession({ tokenHash: tokenHash(token), now });
      return record
        ? { token, expiresAt: record.expiresAt, csrfToken: csrfToken(this.secret, token) }
        : undefined;
    } catch {
      return undefined;
    }
  }

  private safeNow(): string | undefined {
    try {
      return this.now().toISOString();
    } catch {
      return undefined;
    }
  }

  private serializeCookie(token: string, expiresAt: string): string {
    return [
      `${this.cookieName}=${token}`,
      "Path=/",
      "HttpOnly",
      ...(this.secureCookies ? ["Secure"] : []),
      "SameSite=Strict",
      "Priority=High",
      `Expires=${new Date(expiresAt).toUTCString()}`,
      `Max-Age=${SESSION_DURATION_MILLISECONDS / 1_000}`,
    ].join("; ");
  }

  private clearCookie(): string {
    return [
      `${this.cookieName}=`,
      "Path=/",
      "HttpOnly",
      ...(this.secureCookies ? ["Secure"] : []),
      "SameSite=Strict",
      "Priority=High",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      "Max-Age=0",
    ].join("; ");
  }
}
