const WRITE_SCOPE = "ai_world.run.write";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

const input = process.argv[2] ?? process.env.AGENT_WORLD_LIVE_BASE_URL;
if (!input) {
  throw new Error(
    "Usage: npm run test:production-preflight --workspace @agent-world/web -- https://ai-world.example.com",
  );
}

const base = canonicalProductionOrigin(input);
const origin = base.origin;
const mcpResource = `${origin}/api/mcp`;
const expectedIssuer = `${origin}/oauth`;
const protectedMetadataUrl = `${origin}/.well-known/oauth-protected-resource/api/mcp`;
const oauthMetadataUrl = `${origin}/.well-known/oauth-authorization-server/oauth`;

const checks = [];

await check("HTTPS live health", async () => {
  const response = await request(`${origin}/api/health/live`);
  expectStatus(response, 200, "live health");
  const body = await readJson(response, "live health");
  assert(body?.status === "alive", "live health body must be {status: alive}");
  assert(Boolean(response.headers.get("strict-transport-security")), "HSTS header is required");
  assert(!response.headers.has("server"), "Server header must be removed at the public edge");
});

await check("PostgreSQL readiness", async () => {
  const response = await request(`${origin}/api/health/ready`);
  expectStatus(response, 200, "ready health");
  const body = await readJson(response, "ready health");
  assert(body?.status === "ready", "ready health body must be {status: ready}");
});

let protectedMetadata;
await check("RFC 9728 protected-resource metadata", async () => {
  const response = await request(protectedMetadataUrl);
  expectStatus(response, 200, "protected-resource metadata");
  protectedMetadata = await readJson(response, "protected-resource metadata");
  assert(protectedMetadata?.resource === mcpResource, `resource must equal ${mcpResource}`);
  assert(
    Array.isArray(protectedMetadata?.authorization_servers) &&
      protectedMetadata.authorization_servers.length === 1 &&
      protectedMetadata.authorization_servers[0] === expectedIssuer,
    `authorization_servers must contain only ${expectedIssuer}`,
  );
  assert(
    Array.isArray(protectedMetadata?.bearer_methods_supported) &&
      protectedMetadata.bearer_methods_supported.includes("header"),
    "bearer header authentication must be advertised",
  );
  assert(
    Array.isArray(protectedMetadata?.scopes_supported) &&
      protectedMetadata.scopes_supported.includes(WRITE_SCOPE),
    `${WRITE_SCOPE} must be advertised`,
  );
});

let oauthMetadata;
await check("OAuth discovery, PKCE, refresh and DCR", async () => {
  const response = await request(oauthMetadataUrl);
  expectStatus(response, 200, "OAuth metadata");
  oauthMetadata = await readJson(response, "OAuth metadata");
  assert(oauthMetadata?.issuer === expectedIssuer, `issuer must equal ${expectedIssuer}`);
  expectExactUrl(
    oauthMetadata?.authorization_endpoint,
    `${expectedIssuer}/auth`,
    "authorization_endpoint",
  );
  expectExactUrl(oauthMetadata?.token_endpoint, `${expectedIssuer}/token`, "token_endpoint");
  expectExactUrl(
    oauthMetadata?.registration_endpoint,
    `${expectedIssuer}/reg`,
    "registration_endpoint",
  );
  expectExactUrl(
    oauthMetadata?.revocation_endpoint,
    `${expectedIssuer}/token/revocation`,
    "revocation_endpoint",
  );
  expectExactUrl(oauthMetadata?.jwks_uri, `${expectedIssuer}/jwks`, "jwks_uri");
  expectIncludes(
    oauthMetadata?.grant_types_supported,
    "authorization_code",
    "grant_types_supported",
  );
  expectIncludes(oauthMetadata?.grant_types_supported, "refresh_token", "grant_types_supported");
  expectIncludes(oauthMetadata?.response_types_supported, "code", "response_types_supported");
  expectIncludes(
    oauthMetadata?.code_challenge_methods_supported,
    "S256",
    "code_challenge_methods_supported",
  );
  expectIncludes(
    oauthMetadata?.token_endpoint_auth_methods_supported,
    "none",
    "token_endpoint_auth_methods_supported",
  );
  expectIncludes(oauthMetadata?.scopes_supported, "offline_access", "scopes_supported");
  expectIncludes(oauthMetadata?.scopes_supported, WRITE_SCOPE, "scopes_supported");
});

await check("Public ES256 JWKS contains no private key material", async () => {
  const jwksUrl = oauthMetadata?.jwks_uri;
  expectSameOriginHttps(jwksUrl, "jwks_uri");
  const response = await request(jwksUrl);
  expectStatus(response, 200, "JWKS");
  const jwks = await readJson(response, "JWKS");
  assert(Array.isArray(jwks?.keys) && jwks.keys.length >= 1, "JWKS must contain at least one key");
  assert(
    jwks.keys.every((key) => key && key.d === undefined),
    "public JWKS must not expose private d values",
  );
  assert(
    jwks.keys.some(
      (key) =>
        key?.kty === "EC" &&
        key?.crv === "P-256" &&
        typeof key?.x === "string" &&
        key.x.length > 0 &&
        typeof key?.y === "string" &&
        key.y.length > 0 &&
        (key?.alg === undefined || key.alg === "ES256"),
    ),
    "JWKS must expose an ES256-compatible P-256 public key",
  );
});

await check("MCP resource fails closed without bearer token", async () => {
  const response = await request(mcpResource, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  expectStatus(response, 401, "unauthenticated MCP request");
  const body = await readJson(response, "unauthenticated MCP request");
  assert(
    body?.error?.code === "UNAUTHORIZED",
    "MCP must return UNAUTHORIZED without a bearer token",
  );
  const challenge = response.headers.get("www-authenticate") ?? "";
  assert(
    challenge.includes(`resource_metadata="${protectedMetadataUrl}"`),
    "MCP challenge must point to protected-resource metadata",
  );
  assert(
    challenge.includes(`scope="${WRITE_SCOPE}"`),
    "MCP challenge must request the write scope",
  );
});

await check("Native Chat launcher control is enabled and bearer-protected", async () => {
  const response = await request(`${origin}/api/native-chat-launcher`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, action: "CLAIM", leaseMs: 120000 }),
  });
  expectStatus(response, 401, "unauthenticated launcher control request");
  const body = await readJson(response, "unauthenticated launcher control request");
  assert(
    body?.error?.code === "UNAUTHORIZED",
    "launcher control must be configured and bearer-protected",
  );
});

await check("Custom GPT Actions fallback contract", async () => {
  const response = await request(`${origin}/api/chat-actions/openapi.json`);
  expectStatus(response, 200, "Actions OpenAPI");
  const spec = await readJson(response, "Actions OpenAPI");
  assert(spec?.openapi === "3.1.0", "Actions contract must be OpenAPI 3.1.0");
  assert(spec?.servers?.[0]?.url === origin, "Actions contract must target the production origin");
  const expectedOperations = new Map([
    ["/api/chat-actions/runs/begin", "beginRun"],
    ["/api/chat-actions/runs/resources", "getRunResources"],
    ["/api/chat-actions/runs/events", "emitRunEvent"],
    ["/api/chat-actions/runs/commit", "commitResult"],
    ["/api/chat-actions/runs/fail", "failRun"],
  ]);
  for (const [path, operationId] of expectedOperations) {
    assert(
      spec?.paths?.[path]?.post?.operationId === operationId,
      `${path} must expose ${operationId}`,
    );
    const security = spec.paths[path].post.security;
    assert(
      Array.isArray(security) && security.some((entry) => entry?.oauth?.includes?.(WRITE_SCOPE)),
      `${path} must require ${WRITE_SCOPE}`,
    );
  }
  const flow = spec?.components?.securitySchemes?.oauth?.flows?.authorizationCode;
  assert(
    flow?.authorizationUrl === `${expectedIssuer}/auth`,
    "Actions authorization URL must use the AI World issuer",
  );
  assert(
    flow?.tokenUrl === `${expectedIssuer}/token`,
    "Actions token URL must use the AI World issuer",
  );
});

process.stdout.write(
  `${JSON.stringify(
    {
      status: "PASS",
      origin,
      checks,
      nextLiveGates: [
        "personal Plus MCP/App run through terminal commit_result",
        "approved bounded SSH operation against the provisioned host",
        "real ChatGPT-authenticated Codex run with terminal provenance",
      ],
    },
    null,
    2,
  )}\n`,
);

async function check(name, operation) {
  try {
    await operation();
    checks.push({ name, status: "PASS" });
  } catch (error) {
    checks.push({ name, status: "FAIL", reason: safeMessage(error) });
    process.stderr.write(`${JSON.stringify({ status: "FAIL", origin, checks }, null, 2)}\n`);
    throw error;
  }
}

async function request(url, init = {}) {
  expectSameOriginHttps(url, "request URL");
  return fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "user-agent": "ai-world-production-preflight/1",
      ...(init.headers ?? {}),
    },
  });
}

async function readJson(response, label) {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new Error(`${label} response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error(`${label} response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

function canonicalProductionOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Production preflight target must be a valid absolute HTTPS URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "Production preflight target must be an HTTPS origin without path, credentials, query or fragment",
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new Error("Production preflight refuses loopback targets");
  }
  return new URL(url.origin);
}

function expectSameOriginHttps(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  assert(url.protocol === "https:", `${label} must use HTTPS`);
  assert(!url.username && !url.password, `${label} must not contain credentials`);
  assert(url.origin === origin, `${label} must remain on the AI World production origin`);
}

function expectExactUrl(value, expected, label) {
  assert(value === expected, `${label} must equal ${expected}`);
  expectSameOriginHttps(value, label);
}

function expectIncludes(value, expected, label) {
  assert(Array.isArray(value) && value.includes(expected), `${label} must include ${expected}`);
}

function expectStatus(response, expected, label) {
  assert(
    response.status === expected,
    `${label} returned HTTP ${response.status}; expected ${expected}`,
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}
