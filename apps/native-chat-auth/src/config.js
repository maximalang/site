import { readFile } from "node:fs/promises";

const ACCOUNT_ID = /^account_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function exactHttpsUrl(value, suffix) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${suffix} must be a public HTTPS URL without credentials, query, or fragment`);
  }
  return url.toString().replace(/\/$/, "");
}

async function jsonFile(env, key) {
  const path = required(env, key);
  return JSON.parse(await readFile(path, "utf8"));
}

function validateJwks(value) {
  if (!value || !Array.isArray(value.keys) || value.keys.length < 1) {
    throw new Error("OAuth JWK Set is required");
  }
  const kids = new Set();
  for (const key of value.keys) {
    if (
      key?.kty !== "EC" ||
      key.crv !== "P-256" ||
      key.alg !== "ES256" ||
      key.use !== "sig" ||
      typeof key.kid !== "string" ||
      !key.kid ||
      typeof key.d !== "string"
    )
      throw new Error("Every OAuth key must be a private ES256 P-256 signing JWK with kid");
    if (kids.has(key.kid)) throw new Error("OAuth signing JWK kids must be unique");
    kids.add(key.kid);
  }
  return value;
}

function validateCookieKeys(value) {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.some((key) => typeof key !== "string" || key.length < 43)
  ) {
    throw new Error("At least two persistent OAuth cookie keys are required");
  }
  return value;
}

export async function loadConfig(env = process.env) {
  const issuer = exactHttpsUrl(required(env, "AGENT_WORLD_MCP_OAUTH_ISSUER"), "OAuth issuer");
  const resource = exactHttpsUrl(required(env, "AGENT_WORLD_MCP_RESOURCE"), "MCP resource");
  if (resource === issuer || !resource.endsWith("/api/mcp")) {
    throw new Error("MCP resource must be distinct from issuer and end in /api/mcp");
  }
  const issuerUrl = new URL(issuer);
  const prefix = issuerUrl.pathname === "/" ? "" : issuerUrl.pathname;
  if (prefix?.split("/").filter(Boolean).length !== 1) {
    throw new Error("OAuth issuer must use one non-root path segment");
  }
  const passwordHash = required(env, "AGENT_WORLD_OWNER_PASSWORD_HASH");
  if (!passwordHash.startsWith("scrypt-v1$32768$8$1$")) {
    throw new Error("Owner password hash must use the canonical AI World scrypt profile");
  }
  return {
    issuer,
    resource,
    prefix,
    scope: "ai_world.run.write",
    passwordHash,
    jwks: validateJwks(await jsonFile(env, "AGENT_WORLD_MCP_OAUTH_JWKS_FILE")),
    cookieKeys: validateCookieKeys(await jsonFile(env, "AGENT_WORLD_MCP_OAUTH_COOKIE_KEYS_FILE")),
  };
}

export function parseAccountId(value) {
  return typeof value === "string" && ACCOUNT_ID.test(value) ? value : undefined;
}
