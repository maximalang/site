export type OwnerSession = {
  schemaVersion: 1;
  authenticated: true;
  csrfToken: string;
  expiresAt: string;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class AuthenticationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Authentication request failed");
    this.name = "AuthenticationApiError";
  }
}

function parseSession(input: unknown): OwnerSession {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 4 ||
    !("schemaVersion" in input) ||
    input.schemaVersion !== 1 ||
    !("authenticated" in input) ||
    input.authenticated !== true ||
    !("csrfToken" in input) ||
    typeof input.csrfToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.csrfToken) ||
    !("expiresAt" in input) ||
    typeof input.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(input.expiresAt))
  ) {
    throw new Error("Invalid authentication response");
  }
  return input as OwnerSession;
}

async function errorFrom(response: Response): Promise<AuthenticationApiError> {
  let code = "AUTHENTICATION_UNAVAILABLE";
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    if (typeof body.error?.code === "string" && /^[A-Z_]{1,64}$/.test(body.error.code)) {
      code = body.error.code;
    }
  } catch {
    // Status remains authoritative when an error body is absent or malformed.
  }
  return new AuthenticationApiError(response.status, code);
}

export async function loadOwnerSession(fetcher: Fetcher = fetch): Promise<OwnerSession> {
  const response = await fetcher("/api/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
    method: "GET",
  });
  if (!response.ok) throw await errorFrom(response);
  return parseSession(await response.json());
}

export async function loginOwner(
  password: string,
  fetcher: Fetcher = fetch,
): Promise<OwnerSession> {
  const response = await fetcher("/api/auth/login", {
    body: JSON.stringify({ schemaVersion: 1, password }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw await errorFrom(response);
  return parseSession(await response.json());
}

export async function logoutOwner(csrfToken: string, fetcher: Fetcher = fetch): Promise<void> {
  const response = await fetcher("/api/auth/logout", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "X-Agent-World-CSRF": csrfToken },
    method: "POST",
  });
  if (!response.ok) throw await errorFrom(response);
}
