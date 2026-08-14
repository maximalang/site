import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";

const { Pool } = pg;
const ADMIN_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";
const PASSWORD = "native-chat-lifecycle-test-password-not-a-production-secret";
const ACCOUNT_ID = "account_11111111-1111-1111-1111-111111111111";
const SECOND_ACCOUNT_ID = "account_22222222-2222-2222-2222-222222222222";
const RESOURCE = "https://agent-world.example.com/api/mcp";
const ISSUER = "https://agent-world.example.com/oauth";
const SCOPE = "ai_world.run.write";

function form(values) {
  return new URLSearchParams(values).toString();
}
function decodeJwt(token) {
  const parts = String(token).split(".");
  assert.equal(parts.length, 3);
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}
function extractCsrf(html) {
  const match = html.match(/name="csrf" value="([^"]+)"/);
  assert.ok(match, "CSRF field must be rendered");
  return match[1];
}
function makeCookieJar() {
  const values = new Map();
  return {
    absorb(response) {
      const setCookies =
        typeof response.headers.getSetCookie === "function"
          ? response.headers.getSetCookie()
          : [response.headers.get("set-cookie")].filter(Boolean);
      for (const value of setCookies) {
        const first = value.split(";", 1)[0];
        const index = first.indexOf("=");
        if (index > 0) values.set(first.slice(0, index), first.slice(index + 1));
      }
    },
    header() {
      return [...values.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    },
  };
}
async function prepareStorage() {
  const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  await pool.query("DROP SCHEMA IF EXISTS agent_world_oauth CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS agent_world CASCADE");
  await pool.query(`
    CREATE SCHEMA agent_world;
    CREATE SCHEMA agent_world_oauth;
    CREATE TABLE agent_world.accounts (id text PRIMARY KEY, label text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE agent_world.account_surfaces (account_id text NOT NULL REFERENCES agent_world.accounts(id), surface text NOT NULL, PRIMARY KEY (account_id, surface));
    CREATE TABLE agent_world.execution_routes (id text PRIMARY KEY, account_id text REFERENCES agent_world.accounts(id), mode text NOT NULL, adapter_kind text NOT NULL, is_enabled boolean NOT NULL);
    CREATE TABLE agent_world_oauth.oidc_store (
      model text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
      expires_at timestamptz, consumed_at timestamptz, grant_id text, user_code text, uid text,
      PRIMARY KEY (model, id)
    );
    CREATE TABLE agent_world_oauth.login_throttle (
      throttle_key text PRIMARY KEY, failures integer NOT NULL DEFAULT 0,
      locked_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE agent_world_oauth.account_grants (
      grant_id text PRIMARY KEY, client_id text NOT NULL,
      account_id text NOT NULL REFERENCES agent_world.accounts(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO agent_world.accounts (id, label) VALUES ('${ACCOUNT_ID}', 'Plus account one');
    INSERT INTO agent_world.accounts (id, label) VALUES ('${SECOND_ACCOUNT_ID}', 'Plus account two');
    INSERT INTO agent_world.account_surfaces (account_id, surface) VALUES ('${ACCOUNT_ID}', 'CHAT');
    INSERT INTO agent_world.account_surfaces (account_id, surface) VALUES ('${SECOND_ACCOUNT_ID}', 'CHAT');
    INSERT INTO agent_world.execution_routes (id, account_id, mode, adapter_kind, is_enabled)
      VALUES ('route_11111111-1111-1111-1111-111111111111', '${ACCOUNT_ID}', 'CHAT', 'NATIVE_CHATGPT', true);
    INSERT INTO agent_world.execution_routes (id, account_id, mode, adapter_kind, is_enabled)
      VALUES ('route_22222222-2222-2222-2222-222222222222', '${SECOND_ACCOUNT_ID}', 'CHAT', 'NATIVE_CHATGPT', true);
  `);
  await pool.end();
}
async function createFixtureFiles() {
  const dir = await mkdtemp(join(tmpdir(), "rr-native-chat-lifecycle-"));
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privateJwk = privateKey.export({ format: "jwk" });
  const jwksFile = join(dir, "jwks.json");
  const cookieFile = join(dir, "cookie-keys.json");
  await writeFile(
    jwksFile,
    JSON.stringify({
      keys: [{ ...privateJwk, kid: "native-chat-lifecycle-key", alg: "ES256", use: "sig" }],
    }),
    { mode: 0o600 },
  );
  await writeFile(
    cookieFile,
    JSON.stringify([randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")]),
    { mode: 0o600 },
  );
  return { dir, jwksFile, cookieFile };
}
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}
async function stop(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
function client(base, jar = makeCookieJar()) {
  return {
    jar,
    async request(path, options = {}) {
      const headers = new Headers(options.headers || {});
      headers.set("host", "agent-world.example.com");
      headers.set("x-forwarded-host", "agent-world.example.com");
      headers.set("x-forwarded-proto", "https");
      headers.set("x-real-ip", "203.0.113.60");
      if (jar.header()) headers.set("cookie", jar.header());
      const response = await fetch(`${base}${path}`, { ...options, headers, redirect: "manual" });
      jar.absorb(response);
      return response;
    },
  };
}
async function registerPublicClient(httpClient) {
  const response = await httpClient.request("/oauth/reg", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ChatGPT cached Native Chat MCP client",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"],
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.deepEqual(body.grant_types, ["authorization_code", "refresh_token"]);
  return body.client_id;
}
function authorizationPath(clientId, verifier, scope) {
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope,
    resource: RESOURCE,
    prompt: "consent",
    state: "state-native-chat-lifecycle",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `/oauth/auth?${params}`;
}
async function completeAuthorization(
  httpClient,
  clientId,
  verifier,
  scope,
  accountId = ACCOUNT_ID,
) {
  let response = await httpClient.request(authorizationPath(clientId, verifier, scope));
  assert.ok([302, 303].includes(response.status));
  let location = response.headers.get("location");
  assert.ok(location?.startsWith("/oauth/interaction/"));

  response = await httpClient.request(location);
  assert.equal(response.status, 200);
  let csrf = extractCsrf(await response.text());
  response = await httpClient.request(`${location.replace(/\/$/, "")}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ csrf, account_id: accountId, password: PASSWORD }),
  });
  assert.ok([302, 303].includes(response.status));
  location = response.headers.get("location");
  assert.ok(location);

  let follow = new URL(location, ISSUER);
  response = await httpClient.request(follow.pathname + follow.search);
  assert.ok(
    [302, 303].includes(response.status),
    `authorization resume returned ${response.status}: ${await response.text()}`,
  );
  location = response.headers.get("location");
  assert.ok(location?.startsWith("/oauth/interaction/"));

  response = await httpClient.request(location);
  assert.equal(response.status, 200);
  csrf = extractCsrf(await response.text());
  response = await httpClient.request(`${location.replace(/\/$/, "")}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ csrf }),
  });
  assert.ok([302, 303].includes(response.status));
  location = response.headers.get("location");
  assert.ok(location);

  follow = new URL(location, ISSUER);
  response = await httpClient.request(follow.pathname + follow.search);
  assert.ok([302, 303].includes(response.status));
  const callback = new URL(response.headers.get("location"));
  assert.equal(callback.origin + callback.pathname, REDIRECT_URI);
  assert.equal(callback.searchParams.get("state"), "state-native-chat-lifecycle");
  const code = callback.searchParams.get("code");
  assert.ok(code);
  return code;
}
async function exchangeCode(httpClient, clientId, code, verifier) {
  return httpClient.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      resource: RESOURCE,
    }),
  });
}
async function refresh(httpClient, clientId, refreshToken) {
  return httpClient.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      resource: RESOURCE,
    }),
  });
}
async function persistedModels() {
  const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const { rows } = await pool.query(
    "SELECT model, COUNT(*)::int AS count FROM agent_world_oauth.oidc_store GROUP BY model ORDER BY model",
  );
  await pool.end();
  return new Map(rows.map((row) => [row.model, row.count]));
}

async function persistedAccountGrant() {
  const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const { rows } = await pool.query(
    "SELECT client_id, account_id FROM agent_world_oauth.account_grants",
  );
  await pool.end();
  return rows;
}

test("ChatGPT OAuth lifecycle survives cached scope omission and application restart", async () => {
  await prepareStorage();
  const fixture = await createFixtureFiles();
  const salt = Buffer.alloc(16, 7);
  const digest = scryptSync(PASSWORD, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const passwordHash = `scrypt-v1$32768$8$1$${salt.toString("base64url")}$${digest.toString("base64url")}`;
  process.env.NODE_ENV = "test";
  process.env.AGENT_WORLD_MCP_AUTH_PROVIDER = "local_oidc";
  process.env.AGENT_WORLD_MCP_OAUTH_ISSUER = ISSUER;
  process.env.AGENT_WORLD_MCP_RESOURCE = RESOURCE;
  process.env.AGENT_WORLD_OWNER_PASSWORD_HASH = passwordHash;
  process.env.DATABASE_URL = ADMIN_DATABASE_URL;
  process.env.AGENT_WORLD_MCP_OAUTH_JWKS_FILE = fixture.jwksFile;
  process.env.AGENT_WORLD_MCP_OAUTH_COOKIE_KEYS_FILE = fixture.cookieFile;

  const { createNativeChatAuthServer } = await import("../src/server.js");
  let runtime = await createNativeChatAuthServer();
  let base = await listen(runtime.server);
  let httpClient = client(base);
  try {
    const discoveryResponse = await httpClient.request("/oauth/.well-known/openid-configuration");
    assert.equal(discoveryResponse.status, 200);
    const discovery = await discoveryResponse.json();
    assert.ok(discovery.scopes_supported.includes("offline_access"));
    assert.deepEqual(discovery.code_challenge_methods_supported, ["S256"]);
    assert.ok(discovery.grant_types_supported.includes("authorization_code"));
    assert.ok(discovery.grant_types_supported.includes("refresh_token"));

    const rfc8414Response = await httpClient.request(
      "/.well-known/oauth-authorization-server/oauth",
    );
    assert.equal(rfc8414Response.status, 200);
    const rfc8414 = await rfc8414Response.json();
    assert.equal(rfc8414.issuer, ISSUER);
    assert.ok(rfc8414.scopes_supported.includes("offline_access"));
    assert.ok(rfc8414.grant_types_supported.includes("refresh_token"));

    const clientId = await registerPublicClient(httpClient);
    const verifier = randomBytes(48).toString("base64url");

    // Emulate an existing ChatGPT Dev App whose cached authorization request was
    // created without offline_access. Reconnect must still produce a renewable session.
    const code = await completeAuthorization(httpClient, clientId, verifier, `openid ${SCOPE}`);
    const tokenResponse = await exchangeCode(httpClient, clientId, code, verifier);
    assert.equal(tokenResponse.status, 200);
    const tokens = await tokenResponse.json();
    assert.ok(tokens.access_token);
    assert.ok(tokens.refresh_token, "authorization-code exchange must return a refresh token");

    const accessClaims = decodeJwt(tokens.access_token);
    assert.equal(accessClaims.iss, ISSUER);
    assert.equal(accessClaims.aud, RESOURCE);
    assert.equal(accessClaims.sub, ACCOUNT_ID);
    assert.ok(accessClaims.exp > accessClaims.iat);
    assert.ok(accessClaims.exp - accessClaims.iat <= 15 * 60 + 5);

    // Reuse the same registered Dev App from a separate ChatGPT account/browser
    // profile. The OAuth client remains shared while the canonical Account binding
    // is explicitly selected per authorization.
    httpClient = client(base);
    const secondVerifier = randomBytes(48).toString("base64url");
    const secondCode = await completeAuthorization(
      httpClient,
      clientId,
      secondVerifier,
      `openid ${SCOPE}`,
      SECOND_ACCOUNT_ID,
    );
    const secondTokenResponse = await exchangeCode(
      httpClient,
      clientId,
      secondCode,
      secondVerifier,
    );
    assert.equal(secondTokenResponse.status, 200);
    const secondTokens = await secondTokenResponse.json();
    assert.equal(decodeJwt(secondTokens.access_token).sub, SECOND_ACCOUNT_ID);

    const models = await persistedModels();
    assert.ok((models.get("Client") || 0) >= 1, "dynamic clients must be persisted in PostgreSQL");
    assert.ok(
      (models.get("Grant") || 0) >= 1,
      "authorization grants must be persisted in PostgreSQL",
    );
    assert.ok(
      (models.get("RefreshToken") || 0) >= 1,
      "refresh tokens must be persisted in PostgreSQL",
    );
    const accountGrants = await persistedAccountGrant();
    assert.equal(accountGrants.length, 2);
    assert.deepEqual(
      new Set(accountGrants.map((grant) => grant.account_id)),
      new Set([ACCOUNT_ID, SECOND_ACCOUNT_ID]),
    );
    assert.ok(accountGrants.every((grant) => grant.client_id === clientId));

    await stop(runtime.server);

    // Recreate the whole application process with the same PostgreSQL storage and
    // persistent signing/cookie key files, exactly like a Docker restart/deploy.
    runtime = await createNativeChatAuthServer();
    base = await listen(runtime.server);
    httpClient = client(base);

    const refreshResponse = await refresh(httpClient, clientId, tokens.refresh_token);
    assert.equal(refreshResponse.status, 200);
    const rotated = await refreshResponse.json();
    assert.ok(rotated.access_token);
    assert.ok(rotated.refresh_token);
    assert.notEqual(
      rotated.refresh_token,
      tokens.refresh_token,
      "refresh-token rotation must issue the next refresh token",
    );
    assert.notEqual(rotated.access_token, tokens.access_token);

    const refreshedClaims = decodeJwt(rotated.access_token);
    assert.equal(refreshedClaims.iss, ISSUER);
    assert.equal(refreshedClaims.aud, RESOURCE);
    assert.equal(refreshedClaims.sub, ACCOUNT_ID);

    const replayResponse = await refresh(httpClient, clientId, tokens.refresh_token);
    assert.equal(replayResponse.status, 400, "reusing a consumed refresh token must be rejected");

    const revokedFamilyResponse = await refresh(httpClient, clientId, rotated.refresh_token);
    assert.equal(
      revokedFamilyResponse.status,
      400,
      "refresh-token replay must revoke the remaining token family",
    );
  } finally {
    await stop(runtime.server);
    await rm(fixture.dir, { recursive: true, force: true });
  }
});
