import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { errors, Provider } from "oidc-provider";
import { loadConfig, parseAccountId } from "./config.js";
import { verifyOwnerPassword } from "./owner-password.js";
import {
  assertAuthStorageReady,
  cleanupExpiredAuthState,
  clearLoginThrottle,
  createAuthPool,
  createPostgresAdapter,
  getLoginThrottle,
  listEligibleChatAccounts,
  recordAccountGrant,
  recordLoginFailure,
} from "./postgres-adapter.js";

const MAX_FORM_BYTES = 8192;
const ACCESS_TOKEN_TTL = 15 * 60;
const AUTHORIZATION_CODE_TTL = 2 * 60;
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;
const SESSION_TTL = 12 * 60 * 60;
const INTERACTION_TTL = 10 * 60;
const CSRF_COOKIE = "__Host-agent_world_mcp_csrf";
const RATE_WINDOW_MS = 60_000;
const PREAUTH_RATE_LIMIT = 180;
const rateBuckets = new Map();

function safeAudit(event, fields = {}) {
  const allowed = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!["client_id", "grant_type", "reason", "subject", "status"].includes(key)) continue;
    if (["string", "number", "boolean"].includes(typeof value))
      allowed[key] = String(value).slice(0, 160);
  }
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: "native-chat-mcp-auth",
      event,
      ...allowed,
    }),
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function securityHeaders(res) {
  res.setHeader("Cache-Control", "no-store, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
}

function formPage({
  uid,
  csrf,
  kind,
  clientName,
  prefix,
  accounts = [],
  selectedAccountId = "",
  error = "",
}) {
  const login = kind === "login";
  const title = login ? "AI World — подключение ChatGPT" : "Разрешить доступ к AI World";
  const action = login
    ? `${prefix}/interaction/${encodeURIComponent(uid)}/login`
    : `${prefix}/interaction/${encodeURIComponent(uid)}/confirm`;
  const accountOptions = accounts
    .map(
      (account) =>
        `<option value="${escapeHtml(account.id)}"${account.id === selectedAccountId ? " selected" : ""}>${escapeHtml(account.label)} · ${escapeHtml(account.id)}</option>`,
    )
    .join("");
  const control = login
    ? `<label>ChatGPT Account<select name="account_id" required>${accountOptions}</select></label><label>Пароль владельца<input name="password" type="password" autocomplete="current-password" required autofocus></label>`
    : "<p>Этот ChatGPT-аккаунт получит доступ к задачам, контексту и записи результатов только от имени выбранного canonical Account.</p>";
  const button = login ? "Подключить аккаунт" : "Разрешить AI World access";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;background:#111;color:#eee;margin:0;display:grid;place-items:center;min-height:100vh}.card{width:min(440px,calc(100vw - 32px));padding:28px;border:1px solid #333;border-radius:16px;background:#171717}h1{font-size:20px;margin:0 0 8px}.muted{color:#aaa;margin:0 0 20px}label{display:grid;gap:8px;margin:18px 0}input{font:inherit;padding:12px;border-radius:10px;border:1px solid #444;background:#0f0f0f;color:#fff}button{font:inherit;width:100%;padding:12px;border:0;border-radius:10px;font-weight:650;cursor:pointer}.error{min-height:22px;color:#ff9b9b}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(clientName || "OAuth client")}</p><div class="error">${escapeHtml(error)}</div><form method="post" action="${action}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${control}<button type="submit">${escapeHtml(button)}</button></form></main></body></html>`;
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1
          ? [part, ""]
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}
function setCsrfCookie(res, value) {
  res.setHeader(
    "Set-Cookie",
    `${CSRF_COOKIE}=${encodeURIComponent(value)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`,
  );
}
function equalSecret(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
async function readForm(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_FORM_BYTES) throw new Error("form_too_large");
    chunks.push(chunk);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")).entries());
}
function throttleKeys(req, accountId) {
  const ip = String(req.headers["x-real-ip"] ?? "");
  return [
    `ip:${createHash("sha256")
      .update(ip || "missing")
      .digest("hex")}`,
    `account:${accountId}`,
  ];
}
function isLocked(rows) {
  return rows.some((row) => row.locked_until && new Date(row.locked_until).getTime() > Date.now());
}
function allowRequest(key, now = Date.now()) {
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (rateBuckets.size > 5_000) {
    for (const [candidate, value] of rateBuckets) {
      if (now - value.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(candidate);
    }
  }
  return bucket.count <= PREAUTH_RATE_LIMIT;
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateRedirectUri(uri) {
  if (typeof uri !== "string" || uri.length > 2048 || uri.includes("*"))
    throw new errors.InvalidClientMetadata("redirect_uris must be exact HTTPS URIs");
  let url;
  try {
    url = new URL(uri);
  } catch {
    throw new errors.InvalidClientMetadata("redirect_uris must be valid absolute URIs");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new errors.InvalidClientMetadata(
      "redirect_uris must be exact HTTPS URIs without credentials or fragments",
    );
}
function validateDynamicClientMetadata(metadata) {
  if (metadata.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== "none")
    throw new errors.InvalidClientMetadata("Only public clients are accepted");
  if (
    metadata.response_types &&
    (!Array.isArray(metadata.response_types) ||
      metadata.response_types.length !== 1 ||
      metadata.response_types[0] !== "code")
  )
    throw new errors.InvalidClientMetadata("Only response_type=code is accepted");
  if (
    metadata.grant_types &&
    (!Array.isArray(metadata.grant_types) ||
      metadata.grant_types.some(
        (value) => !["authorization_code", "refresh_token"].includes(value),
      ))
  )
    throw new errors.InvalidClientMetadata(
      "Only authorization_code and refresh_token grants are accepted",
    );
  if (
    !Array.isArray(metadata.redirect_uris) ||
    metadata.redirect_uris.length < 1 ||
    metadata.redirect_uris.length > 5
  )
    throw new errors.InvalidClientMetadata("One to five exact redirect_uris are required");
  metadata.redirect_uris.forEach(validateRedirectUri);
  metadata.token_endpoint_auth_method = "none";
  metadata.response_types = ["code"];
  metadata.grant_types = ["authorization_code", "refresh_token"];
}

export async function createNativeChatAuthServer(environment = process.env) {
  if (environment.AGENT_WORLD_MCP_AUTH_PROVIDER !== "local_oidc") {
    throw new Error("AGENT_WORLD_MCP_AUTH_PROVIDER must be local_oidc");
  }
  const config = await loadConfig(environment);
  const { issuer: ISSUER, resource: RESOURCE, prefix: OIDC_PREFIX, scope: MCP_SCOPE } = config;
  const RFC8414_PATH = `/.well-known/oauth-authorization-server${OIDC_PREFIX}`;
  const ownerPasswordHash = config.passwordHash;
  const jwks = config.jwks;
  const cookieKeys = config.cookieKeys;
  const pool = createAuthPool();
  await assertAuthStorageReady(pool);
  const Adapter = createPostgresAdapter(pool);

  const provider = new Provider(ISSUER, {
    adapter: Adapter,
    clients: [],
    claims: { openid: ["sub"] },
    clientAuthMethods: ["none"],
    clientDefaults: {
      token_endpoint_auth_method: "none",
      id_token_signed_response_alg: "ES256",
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"],
    },
    allowOmittingSingleRegisteredRedirectUri: false,
    cookies: { keys: cookieKeys },
    extraClientMetadata: {
      properties: ["agent_world_profile"],
      validator(_ctx, _key, _value, metadata) {
        validateDynamicClientMetadata(metadata);
        metadata.agent_world_profile = "native-plus-chat";
      },
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true, issueRegistrationAccessToken: false },
      registrationManagement: { enabled: false },
      revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource() {
          return undefined;
        },
        useGrantedResource() {
          return false;
        },
        getResourceServerInfo(_ctx, resource) {
          if (resource !== RESOURCE) throw new errors.InvalidTarget("Unknown resource");
          return {
            audience: RESOURCE,
            scope: MCP_SCOPE,
            accessTokenTTL: ACCESS_TOKEN_TTL,
            accessTokenFormat: "jwt",
            jwt: { sign: { alg: "ES256" } },
          };
        },
      },
    },
    async findAccount(_ctx, id) {
      const accountId = parseAccountId(id);
      if (
        !accountId ||
        !(await listEligibleChatAccounts(pool)).some((account) => account.id === accountId)
      )
        return undefined;
      return {
        accountId,
        async claims() {
          return { sub: accountId };
        },
      };
    },
    idTokenSigningAlgValues: ["ES256"],
    interactions: {
      url(_ctx, interaction) {
        return `${OIDC_PREFIX}/interaction/${interaction.uid}`;
      },
    },
    // ChatGPT caches OAuth discovery/client metadata for an existing Dev App. A reconnect
    // can therefore repeat an authorization request created before offline_access was seen.
    // This provider is isolated to the single AI World MCP resource and DCR always grants
    // refresh_token, so issue a renewable session after successful AI World authorization
    // even when that cached request omitted the OIDC offline_access hint.
    issueRefreshToken(_ctx, client, code) {
      const renewable = client.grantTypeAllowed("refresh_token");
      if (renewable && !code.scopes.has("offline_access")) {
        safeAudit("refresh_compatibility_path", {
          client_id: client.clientId ?? "",
          reason: "offline_access_not_requested",
        });
      }
      return renewable;
    },
    jwks,
    pkce: {
      required() {
        return true;
      },
    },
    routes: {
      authorization: `${OIDC_PREFIX}/auth`,
      jwks: `${OIDC_PREFIX}/jwks`,
      registration: `${OIDC_PREFIX}/reg`,
      revocation: `${OIDC_PREFIX}/token/revocation`,
      token: `${OIDC_PREFIX}/token`,
    },
    responseTypes: ["code"],
    grantTypes: ["authorization_code", "refresh_token"],
    rotateRefreshToken: true,
    scopes: ["openid", "offline_access", MCP_SCOPE],
    ttl: {
      AccessToken: ACCESS_TOKEN_TTL,
      AuthorizationCode: AUTHORIZATION_CODE_TTL,
      Grant: REFRESH_TOKEN_TTL,
      IdToken: ACCESS_TOKEN_TTL,
      RefreshToken: REFRESH_TOKEN_TTL,
      Session: SESSION_TTL,
      Interaction: INTERACTION_TTL,
    },
  });
  provider.proxy = true;
  provider.on("authorization.success", (ctx) =>
    safeAudit("authorization_granted", {
      client_id: ctx.oidc?.client?.clientId ?? "",
      subject: ctx.oidc?.account?.accountId ?? "",
    }),
  );
  provider.on("grant.success", (ctx) => {
    if (ctx.oidc?.params?.grant_type === "refresh_token")
      safeAudit("token_refresh", {
        client_id: ctx.oidc?.client?.clientId ?? "",
        grant_type: "refresh_token",
      });
  });
  provider.on("grant.error", (ctx, error) => {
    if (ctx.oidc?.params?.grant_type === "refresh_token") {
      safeAudit("token_refresh_failed", {
        client_id: ctx.oidc?.client?.clientId ?? "",
        grant_type: "refresh_token",
        reason: error?.error || error?.message || "unknown_refresh_error",
      });
    }
  });
  provider.on("refresh_token.consumed", (token) =>
    safeAudit("refresh_token_rotated", { client_id: token?.clientId ?? "" }),
  );
  provider.on("grant.revoked", (ctx) =>
    safeAudit("grant_revoked", {
      client_id: ctx.oidc?.client?.clientId ?? "",
      reason:
        ctx.oidc?.params?.grant_type === "refresh_token"
          ? "refresh_token_reuse_or_revocation"
          : "revoked",
    }),
  );
  provider.on("revocation.success", (ctx) =>
    safeAudit("token_revoked", { client_id: ctx.oidc?.client?.clientId ?? "" }),
  );
  provider.on("client.created", (client) =>
    safeAudit("client_registered", { client_id: client.clientId ?? "" }),
  );
  const providerCallback = provider.callback();
  const interactionPrefix = escapeRegex(OIDC_PREFIX);

  async function renderInteraction(req, res, uid) {
    const details = await provider.interactionDetails(req, res);
    if (details.uid !== uid) throw new Error("interaction_mismatch");
    const client = await provider.Client.find(details.params.client_id);
    if (!client) throw new Error("client_not_found");
    const csrf = randomBytes(32).toString("base64url");
    securityHeaders(res);
    setCsrfCookie(res, csrf);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (details.prompt.name === "login") {
      const accounts = await listEligibleChatAccounts(pool);
      if (accounts.length === 0) throw new Error("no_eligible_chat_account");
      res.end(
        formPage({
          uid,
          csrf,
          kind: "login",
          prefix: OIDC_PREFIX,
          accounts,
          clientName: client.clientName || client.clientId,
        }),
      );
      return;
    }
    if (details.prompt.name === "consent") {
      const resources = Object.keys(details.prompt.details.missingResourceScopes ?? {});
      const requested = new Set(
        String(details.params.scope ?? "")
          .split(/\s+/)
          .filter(Boolean),
      );
      if (resources.some((resource) => resource !== RESOURCE) || !requested.has(MCP_SCOPE)) {
        await provider.interactionFinished(
          req,
          res,
          {
            error: "access_denied",
            error_description: "Requested authorization is outside the AI World MCP profile",
          },
          { mergeWithLastSubmission: false },
        );
        return;
      }
      res.end(
        formPage({
          uid,
          csrf,
          kind: "consent",
          prefix: OIDC_PREFIX,
          clientName: client.clientName || client.clientId,
        }),
      );
      return;
    }
    throw new Error("unsupported_interaction");
  }

  async function handleLogin(req, res, uid) {
    const details = await provider.interactionDetails(req, res);
    if (details.uid !== uid || details.prompt.name !== "login")
      throw new Error("interaction_mismatch");
    const form = await readForm(req);
    const csrfCookie = parseCookies(req.headers.cookie)[CSRF_COOKIE];
    const accountId = parseAccountId(form.account_id);
    const accounts = await listEligibleChatAccounts(pool);
    const eligible = accountId ? accounts.some((account) => account.id === accountId) : false;
    if (!equalSecret(form.csrf, csrfCookie)) {
      safeAudit("login_denied", { reason: "csrf", subject: accountId ?? "" });
      res.statusCode = 403;
      securityHeaders(res);
      res.end("Forbidden");
      return;
    }
    const keys = throttleKeys(req, accountId ?? "invalid");
    const throttle = await getLoginThrottle(pool, keys);
    const locked = isLocked(throttle);
    let valid = false;
    if (!locked && eligible && typeof form.password === "string" && form.password.length <= 1024) {
      try {
        valid = await verifyOwnerPassword(form.password, ownerPasswordHash);
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      await recordLoginFailure(pool, keys);
      safeAudit("login_denied", {
        reason: locked ? "rate_limited" : "invalid_credentials",
        subject: accountId ?? "",
      });
      const client = await provider.Client.find(details.params.client_id);
      const csrf = randomBytes(32).toString("base64url");
      securityHeaders(res);
      setCsrfCookie(res, csrf);
      res.statusCode = locked ? 429 : 401;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        formPage({
          uid,
          csrf,
          kind: "login",
          prefix: OIDC_PREFIX,
          accounts,
          selectedAccountId: accountId ?? "",
          clientName: client?.clientName || client?.clientId || "OAuth client",
          error: "Неверные данные, Account недоступен или вход временно ограничен.",
        }),
      );
      return;
    }
    await clearLoginThrottle(pool, keys);
    safeAudit("login_success", { subject: accountId });
    await provider.interactionFinished(
      req,
      res,
      {
        login: { accountId, acr: "urn:agent-world:owner:password", amr: ["pwd"], remember: false },
      },
      { mergeWithLastSubmission: false },
    );
  }

  async function handleConsent(req, res, uid) {
    const details = await provider.interactionDetails(req, res);
    const accountId = parseAccountId(details.session?.accountId);
    if (details.uid !== uid || details.prompt.name !== "consent" || !accountId)
      throw new Error("interaction_mismatch");
    if (!(await listEligibleChatAccounts(pool)).some((account) => account.id === accountId))
      throw new Error("account_not_eligible");
    const form = await readForm(req);
    const csrfCookie = parseCookies(req.headers.cookie)[CSRF_COOKIE];
    if (!equalSecret(form.csrf, csrfCookie)) {
      res.statusCode = 403;
      securityHeaders(res);
      res.end("Forbidden");
      return;
    }
    const requested = new Set(
      String(details.params.scope ?? "")
        .split(/\s+/)
        .filter(Boolean),
    );
    const requestedResources = Array.isArray(details.params.resource)
      ? details.params.resource
      : [details.params.resource].filter(Boolean);
    if (
      requestedResources.length !== 1 ||
      requestedResources[0] !== RESOURCE ||
      !requested.has(MCP_SCOPE) ||
      [...requested].some((scope) => !["openid", "offline_access", MCP_SCOPE].includes(scope))
    ) {
      await provider.interactionFinished(
        req,
        res,
        {
          error: "access_denied",
          error_description: "Requested authorization is outside the AI World MCP profile",
        },
        { mergeWithLastSubmission: false },
      );
      return;
    }
    let grantId = details.grantId;
    let grant = grantId ? await provider.Grant.find(grantId) : undefined;
    if (!grant) grant = new provider.Grant({ accountId, clientId: details.params.client_id });
    if (details.prompt.details.missingOIDCScope)
      grant.addOIDCScope(details.prompt.details.missingOIDCScope.join(" "));
    if (details.prompt.details.missingOIDCClaims)
      grant.addOIDCClaims(details.prompt.details.missingOIDCClaims);
    for (const [resource, scopes] of Object.entries(
      details.prompt.details.missingResourceScopes ?? {},
    )) {
      if (resource !== RESOURCE || scopes.some((scope) => scope !== MCP_SCOPE))
        throw new Error("unsafe_resource_scope");
      grant.addResourceScope(resource, scopes.join(" "));
    }
    grantId = await grant.save();
    await recordAccountGrant(pool, { grantId, clientId: details.params.client_id, accountId });
    await provider.interactionFinished(
      req,
      res,
      { consent: details.grantId ? {} : { grantId } },
      { mergeWithLastSubmission: true },
    );
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", ISSUER);
      const sourceIp = String(req.headers["x-real-ip"] ?? "missing");
      const rateKey = createHash("sha256").update(sourceIp).digest("hex");
      if (!allowRequest(rateKey)) {
        securityHeaders(res);
        res.statusCode = 429;
        res.setHeader("Retry-After", "60");
        res.end("Too Many Requests");
        return;
      }
      if (req.method === "GET" && url.pathname === "/healthz") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end('{"ok":true}');
        return;
      }
      const interactionMatch = url.pathname.match(
        new RegExp(`^${interactionPrefix}/interaction/([^/]+)$`),
      );
      const loginMatch = url.pathname.match(
        new RegExp(`^${interactionPrefix}/interaction/([^/]+)/login$`),
      );
      const consentMatch = url.pathname.match(
        new RegExp(`^${interactionPrefix}/interaction/([^/]+)/confirm$`),
      );
      if (req.method === "GET" && interactionMatch) {
        await renderInteraction(req, res, decodeURIComponent(interactionMatch[1]));
        return;
      }
      if (req.method === "POST" && loginMatch) {
        await handleLogin(req, res, decodeURIComponent(loginMatch[1]));
        return;
      }
      if (req.method === "POST" && consentMatch) {
        await handleConsent(req, res, decodeURIComponent(consentMatch[1]));
        return;
      }
      if (url.pathname === RFC8414_PATH) {
        req.url = req.url.replace(RFC8414_PATH, "/.well-known/oauth-authorization-server");
        providerCallback(req, res);
        return;
      }
      if (
        req.method === "GET" &&
        url.pathname === `${OIDC_PREFIX}/auth` &&
        !url.searchParams.has("resume")
      ) {
        const prompts = new Set(
          (url.searchParams.get("prompt") ?? "").split(/\s+/).filter(Boolean),
        );
        prompts.add("login");
        url.searchParams.set("prompt", [...prompts].join(" "));
        req.url = `${url.pathname}${url.search}`;
      }
      if (url.pathname === `${OIDC_PREFIX}/.well-known/openid-configuration`) {
        req.url = req.url.replace(
          `${OIDC_PREFIX}/.well-known/openid-configuration`,
          "/.well-known/openid-configuration",
        );
        providerCallback(req, res);
        return;
      }
      if (url.pathname.startsWith(`${OIDC_PREFIX}/`)) {
        providerCallback(req, res);
        return;
      }
      res.statusCode = 404;
      res.end("Not Found");
    } catch (error) {
      safeAudit("request_denied", {
        reason: error instanceof Error ? error.message : "internal_error",
      });
      if (!res.headersSent) {
        securityHeaders(res);
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      if (!res.writableEnded) res.end("Authentication service error");
    }
  });
  const cleanupTimer = setInterval(
    () => cleanupExpiredAuthState(pool).catch(() => safeAudit("storage_cleanup_failed")),
    15 * 60 * 1000,
  );
  cleanupTimer.unref();
  server.on("close", () => {
    clearInterval(cleanupTimer);
    pool.end().catch(() => undefined);
  });
  return { provider, pool, server };
}
