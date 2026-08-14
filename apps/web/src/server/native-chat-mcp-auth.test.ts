import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyNativeChatMcpAccessToken } from "./native-chat-mcp-auth";

const resource = "https://world.example/api/mcp";
const issuer = "https://world.example/oauth";
const accountId = "account_11111111-1111-1111-1111-111111111111";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-key",
  alg: "ES256",
  use: "sig",
};

function token(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const now = 1_786_707_200;
  const encodedHeader = Buffer.from(
    JSON.stringify({ alg: "ES256", kid: "test-key", ...header }),
  ).toString("base64url");
  const encodedClaims = Buffer.from(
    JSON.stringify({
      iss: issuer,
      aud: resource,
      sub: accountId,
      scope: "ai_world.run.write",
      iat: now - 60,
      exp: now + 300,
      ...overrides,
    }),
  ).toString("base64url");
  const signature = sign("sha256", Buffer.from(`${encodedHeader}.${encodedClaims}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${encodedHeader}.${encodedClaims}.${signature}`;
}

function oauthFetch() {
  return async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("openid-configuration") || url.includes("oauth-authorization-server")) {
      return Response.json({ issuer, jwks_uri: `${issuer}/jwks` });
    }
    if (url === `${issuer}/jwks`) return Response.json({ keys: [publicJwk] });
    return new Response(null, { status: 404 });
  };
}

describe("Native Chat MCP OAuth resource verification", () => {
  it("returns a canonical Account principal for an exact resource-bound token", async () => {
    await expect(
      verifyNativeChatMcpAccessToken(
        `Bearer ${token()}`,
        { issuer, resource },
        oauthFetch(),
        1_786_707_200_000,
      ),
    ).resolves.toEqual({ ok: true, accountId, scopes: new Set(["ai_world.run.write"]) });
  });

  it.each([
    [{ aud: "https://other.example/api/mcp" }, "audience_mismatch"],
    [{ scope: "ai_world.run.read" }, "insufficient_scope"],
    [{ sub: "owner" }, "invalid_account_subject"],
    [{ exp: 1_786_707_100 }, "token_expired"],
  ])("fails closed for invalid claims", async (claims, reason) => {
    await expect(
      verifyNativeChatMcpAccessToken(
        `Bearer ${token(claims)}`,
        { issuer, resource },
        oauthFetch(),
        1_786_707_200_000,
      ),
    ).resolves.toEqual({ ok: false, reason });
  });

  it("rejects unsupported algorithms before OAuth discovery", async () => {
    let fetched = false;
    await expect(
      verifyNativeChatMcpAccessToken(
        `Bearer ${token({}, { alg: "none" })}`,
        { issuer, resource },
        async () => {
          fetched = true;
          return new Response(null, { status: 500 });
        },
        1_786_707_200_000,
      ),
    ).resolves.toEqual({ ok: false, reason: "unsupported_access_token" });
    expect(fetched).toBe(false);
  });
});
