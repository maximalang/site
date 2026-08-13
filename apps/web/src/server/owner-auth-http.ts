import type { OwnerLoginResult, OwnerSessionManager, OwnerSessionResult } from "./owner-session";
import { hasSameOriginHost } from "./request-security";

const MAX_LOGIN_BODY_BYTES = 2_048;
const MAX_PASSWORD_BYTES = 1_024;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export type OwnerAuthPort = Pick<OwnerSessionManager, "login" | "session" | "logout">;

export type OwnerAuthHttpHandlers = {
  login(request: Request): Promise<Response>;
  session(request: Request): Promise<Response>;
  logout(request: Request): Promise<Response>;
};

type AuthErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_CREDENTIALS"
  | "AUTHENTICATION_REQUIRED"
  | "AUTHENTICATION_THROTTLED"
  | "AUTHENTICATION_UNAVAILABLE";

function errorResponse(
  code: AuthErrorCode,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error: { code } },
    { status, headers: { ...RESPONSE_HEADERS, ...headers } },
  );
}

async function readLoginPassword(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new Error("Invalid content type");
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_LOGIN_BODY_BYTES)
  ) {
    throw new Error("Invalid content length");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_LOGIN_BODY_BYTES) {
    throw new Error("Login body is too large");
  }
  const input = JSON.parse(text) as unknown;
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2 ||
    !("schemaVersion" in input) ||
    input.schemaVersion !== 1 ||
    !("password" in input) ||
    typeof input.password !== "string" ||
    input.password.length === 0 ||
    Buffer.byteLength(input.password, "utf8") > MAX_PASSWORD_BYTES
  ) {
    throw new Error("Invalid login body");
  }
  return input.password;
}

function loginResponse(result: OwnerLoginResult): Response {
  if (result.kind === "AUTHENTICATED") {
    return Response.json(
      {
        schemaVersion: 1,
        authenticated: true,
        csrfToken: result.csrfToken,
        expiresAt: result.expiresAt,
      },
      { headers: { ...RESPONSE_HEADERS, "Set-Cookie": result.cookie } },
    );
  }
  switch (result.code) {
    case "INVALID_CREDENTIALS":
      return errorResponse("INVALID_CREDENTIALS", 401);
    case "THROTTLED":
      return errorResponse("AUTHENTICATION_THROTTLED", 429, { "Retry-After": "900" });
    case "UNAVAILABLE":
      return errorResponse("AUTHENTICATION_UNAVAILABLE", 503);
  }
}

function sessionResponse(result: OwnerSessionResult): Response {
  return Response.json(
    {
      schemaVersion: 1,
      authenticated: true,
      csrfToken: result.csrfToken,
      expiresAt: result.expiresAt,
    },
    { headers: RESPONSE_HEADERS },
  );
}

export function createOwnerAuthHttpHandlers(auth: OwnerAuthPort): OwnerAuthHttpHandlers {
  return {
    async login(request) {
      if (!hasSameOriginHost(request)) {
        return errorResponse("INVALID_REQUEST", 400);
      }
      let password: string;
      try {
        password = await readLoginPassword(request);
      } catch {
        return errorResponse("INVALID_REQUEST", 400);
      }
      try {
        return loginResponse(await auth.login(password));
      } catch {
        return errorResponse("AUTHENTICATION_UNAVAILABLE", 503);
      }
    },

    async session(request) {
      try {
        const result = await auth.session(request);
        return result ? sessionResponse(result) : errorResponse("AUTHENTICATION_REQUIRED", 401);
      } catch {
        return errorResponse("AUTHENTICATION_UNAVAILABLE", 503);
      }
    },

    async logout(request) {
      try {
        const clearCookie = await auth.logout(request);
        return clearCookie
          ? new Response(null, {
              status: 204,
              headers: { ...RESPONSE_HEADERS, "Set-Cookie": clearCookie },
            })
          : errorResponse("AUTHENTICATION_REQUIRED", 401);
      } catch {
        return errorResponse("AUTHENTICATION_UNAVAILABLE", 503);
      }
    },
  };
}
