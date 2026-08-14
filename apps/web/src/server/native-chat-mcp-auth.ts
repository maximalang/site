import { createPublicKey, verify as verifySignature } from "node:crypto";
import { AccountIdSchema } from "@agent-world/domain";

const WRITE_SCOPE = "ai_world.run.write";
const CACHE_TTL_MS = 5 * 60_000;
const CLOCK_SKEW_SECONDS = 30;
const MAX_IAT_AGE_SECONDS = 24 * 60 * 60;

type JsonObject = Record<string, unknown>;
type JsonWebKeyRecord = JsonObject & { kid?: string; alg?: string; use?: string };
type OAuthConfig = { issuer: string; resource: string };
type OAuthMetadata = { issuer: string; jwksUri: string };
type Cached<T> = { expiresAt: number; value: T };

const metadataCache = new Map<string, Cached<OAuthMetadata>>();
const jwksCache = new Map<string, Cached<JsonWebKeyRecord[]>>();

export type NativeChatMcpAuthResult =
  | { ok: true; accountId: ReturnType<typeof AccountIdSchema.parse>; scopes: Set<string> }
  | { ok: false; reason: string };

export async function verifyNativeChatMcpAccessToken(
  authorization: string | null,
  configInput: OAuthConfig,
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<NativeChatMcpAuthResult> {
  let config: OAuthConfig;
  try {
    config = { issuer: secureUrl(configInput.issuer), resource: secureUrl(configInput.resource) };
  } catch {
    return { ok: false, reason: "oauth_not_configured" };
  }
  if (!authorization?.startsWith("Bearer ")) return { ok: false, reason: "missing_bearer_token" };
  const token = authorization.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return { ok: false, reason: "malformed_access_token" };
  }

  let header: JsonObject;
  let claims: JsonObject;
  try {
    header = decodeJson(parts[0] ?? "");
    claims = decodeJson(parts[1] ?? "");
  } catch {
    return { ok: false, reason: "malformed_access_token" };
  }
  const alg = typeof header.alg === "string" ? header.alg : "";
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (alg !== "ES256" || !kid) return { ok: false, reason: "unsupported_access_token" };

  try {
    const metadata = await loadMetadata(config.issuer, fetchImpl, nowMs);
    let keys = await loadJwks(metadata.jwksUri, fetchImpl, nowMs, false);
    let key = findKey(keys, kid);
    if (!key) {
      keys = await loadJwks(metadata.jwksUri, fetchImpl, nowMs, true);
      key = findKey(keys, kid);
    }
    if (!key) return { ok: false, reason: "signing_key_not_found" };
    const signature = Buffer.from(parts[2] ?? "", "base64url");
    const valid = verifySignature(
      "sha256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key: createPublicKey({ key: key as never, format: "jwk" }), dsaEncoding: "ieee-p1363" },
      signature,
    );
    if (!valid) return { ok: false, reason: "invalid_signature" };
  } catch {
    return { ok: false, reason: "oauth_discovery_failed" };
  }

  const now = Math.floor(nowMs / 1_000);
  if (claims.iss !== config.issuer) return { ok: false, reason: "issuer_mismatch" };
  if (!hasExactAudience(claims.aud, config.resource)) {
    return { ok: false, reason: "audience_mismatch" };
  }
  if (typeof claims.exp !== "number" || claims.exp <= now - CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "token_expired" };
  }
  if (
    typeof claims.iat !== "number" ||
    claims.iat > now + CLOCK_SKEW_SECONDS ||
    claims.iat < now - MAX_IAT_AGE_SECONDS ||
    claims.iat >= claims.exp
  ) {
    return { ok: false, reason: "invalid_issued_at" };
  }
  if (
    claims.nbf !== undefined &&
    (typeof claims.nbf !== "number" || claims.nbf > now + CLOCK_SKEW_SECONDS)
  ) {
    return { ok: false, reason: "token_not_yet_valid" };
  }
  const scopes = tokenScopes(claims);
  if (!scopes.has(WRITE_SCOPE)) return { ok: false, reason: "insufficient_scope" };
  const account = AccountIdSchema.safeParse(claims.sub);
  if (!account.success) return { ok: false, reason: "invalid_account_subject" };
  return { ok: true, accountId: account.data, scopes };
}

async function loadMetadata(issuer: string, fetchImpl: typeof fetch, now: number) {
  const cached = metadataCache.get(issuer);
  if (cached && cached.expiresAt > now) return cached.value;
  const url = new URL(issuer);
  const issuerBase = issuer.replace(/\/$/, "");
  const candidates = [
    `${issuerBase}/.well-known/openid-configuration`,
    `${url.origin}/.well-known/oauth-authorization-server${url.pathname}`,
  ];
  for (const candidate of candidates) {
    try {
      const body = await fetchObject(candidate, fetchImpl);
      if (body.issuer !== issuer) continue;
      const jwksUri = typeof body.jwks_uri === "string" ? secureUrl(body.jwks_uri) : "";
      if (jwksUri !== `${issuerBase}/jwks`) continue;
      const value = { issuer, jwksUri };
      metadataCache.set(issuer, { expiresAt: now + CACHE_TTL_MS, value });
      return value;
    } catch {
      // Try the RFC 8414 path after OIDC discovery.
    }
  }
  throw new Error("OAuth discovery failed");
}

async function loadJwks(uri: string, fetchImpl: typeof fetch, now: number, force: boolean) {
  const cached = jwksCache.get(uri);
  if (!force && cached && cached.expiresAt > now) return cached.value;
  const body = await fetchObject(uri, fetchImpl);
  if (!Array.isArray(body.keys)) throw new Error("JWKS missing keys");
  const value = body.keys.filter(isObject) as JsonWebKeyRecord[];
  if (value.length === 0) throw new Error("JWKS empty");
  jwksCache.set(uri, { expiresAt: now + CACHE_TTL_MS, value });
  return value;
}

async function fetchObject(uri: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(uri, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("OAuth endpoint unavailable");
  const value = (await response.json()) as unknown;
  if (!isObject(value)) throw new Error("OAuth response is not an object");
  return value;
}

function findKey(keys: JsonWebKeyRecord[], kid: string) {
  return keys.find(
    (key) =>
      key.kid === kid &&
      key.alg === "ES256" &&
      key.use === "sig" &&
      key.kty === "EC" &&
      key.crv === "P-256" &&
      typeof key.x === "string" &&
      typeof key.y === "string" &&
      key.d === undefined,
  );
}

function tokenScopes(claims: JsonObject) {
  const scopes = new Set<string>();
  for (const value of [claims.scope, claims.scp]) {
    if (typeof value === "string")
      for (const scope of value.split(/\s+/)) if (scope) scopes.add(scope);
    if (Array.isArray(value))
      for (const scope of value) if (typeof scope === "string") scopes.add(scope);
  }
  return scopes;
}

function hasExactAudience(value: unknown, expected: string) {
  return typeof value === "string"
    ? value === expected
    : Array.isArray(value) && value.length === 1 && value[0] === expected;
}

function decodeJson(segment: string) {
  const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
  if (!isObject(value)) throw new Error("JWT segment is not an object");
  return value;
}

function secureUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("HTTPS URL required");
  }
  return url.toString().replace(/\/$/, "");
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function resetNativeChatMcpAuthCachesForTests() {
  metadataCache.clear();
  jwksCache.clear();
}
