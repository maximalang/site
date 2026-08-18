import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
const project = `agent-world-native-chat-${suffix}`;
const imageTag = `native-chat-${suffix}`;
const secretDirectory = fileURLToPath(new URL(`../.native-chat-secrets-${suffix}/`, import.meta.url));
const maxBuffer = 64 * 1024 * 1024;
const publicOrigin = "https://ai-world.invalid";
const compose = ["compose", "--project-name", project, "--profile", "native-chat"];

function randomSecret() {
  return randomBytes(32).toString("base64url");
}

function reservePort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function createOAuthSecrets(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwks = {
    keys: [
      {
        ...privateKey.export({ format: "jwk" }),
        alg: "ES256",
        use: "sig",
        kid: `agent-world-native-chat-${randomUUID()}`,
      },
    ],
  };
  const cookieKeys = [randomSecret(), randomSecret()];
  const jwksPath = `${directory}/oauth-jwks.json`;
  const cookieKeysPath = `${directory}/oauth-cookie-keys.json`;
  writeFileSync(jwksPath, `${JSON.stringify(jwks)}\n`, { encoding: "utf8", mode: 0o600 });
  writeFileSync(cookieKeysPath, `${JSON.stringify(cookieKeys)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { jwksPath, cookieKeysPath };
}

function run(args, environment, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: workspaceRoot,
    env: environment,
    encoding: "utf8",
    maxBuffer,
    windowsHide: true,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `docker command failed (${args.slice(0, 7).join(" ")}): ${(result.stderr ?? "").slice(-4_000)}`,
    );
  }
  return result.stdout ?? "";
}

function get(port, path, expectedStatus) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { host: "ai-world.invalid" },
        timeout: 5_000,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 64 * 1024) request.destroy(new Error(`${path} response is oversized`));
        });
        response.once("end", () => {
          if (response.statusCode !== expectedStatus) {
            reject(new Error(`${path} returned ${response.statusCode}, expected ${expectedStatus}`));
            return;
          }
          resolve({ body, headers: response.headers });
        });
      },
    );
    request.once("timeout", () => request.destroy(new Error(`${path} timed out`)));
    request.once("error", reject);
    request.end();
  });
}

const [httpPort, httpsPort] = await Promise.all([reservePort(), reservePort()]);
const { jwksPath, cookieKeysPath } = createOAuthSecrets(secretDirectory);
const environment = {
  ...process.env,
  AGENT_WORLD_POSTGRES_PASSWORD: randomSecret(),
  AGENT_WORLD_CSRF_SECRET: randomSecret(),
  AGENT_WORLD_SECRET_MASTER_KEY: randomSecret(),
  AGENT_WORLD_SECRET_KEY_VERSION: "1",
  AGENT_WORLD_LITELLM_MASTER_KEY: randomSecret(),
  AGENT_WORLD_LITELLM_SALT_KEY: randomSecret(),
  AGENT_WORLD_OWNER_PASSWORD_HASH:
    "scrypt-v1$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  AGENT_WORLD_CODEX_ACCOUNT_ID: "account_00000000-0000-0000-0000-000000000001",
  AGENT_WORLD_HTTP_PORT: String(httpPort),
  AGENT_WORLD_HTTPS_PORT: String(httpsPort),
  AGENT_WORLD_SITE_ADDRESS: ":80",
  AGENT_WORLD_IMAGE_TAG: imageTag,
  AGENT_WORLD_MCP_ENABLED: "true",
  AGENT_WORLD_MCP_RESOURCE: `${publicOrigin}/api/mcp`,
  AGENT_WORLD_MCP_OAUTH_ISSUER: `${publicOrigin}/oauth`,
  AGENT_WORLD_MCP_OAUTH_JWKS_FILE: jwksPath,
  AGENT_WORLD_MCP_OAUTH_COOKIE_KEYS_FILE: cookieKeysPath,
};

try {
  run([...compose, "config", "--quiet"], environment);
  run(
    [
      ...compose,
      "up",
      "-d",
      "--build",
      "--wait",
      "--wait-timeout",
      "180",
      "postgres",
      "litellm",
      "web",
      "native-chat-auth",
      "caddy",
    ],
    environment,
  );

  const ready = JSON.parse((await get(httpPort, "/api/health/ready", 200)).body);
  if (ready.status !== "ready") throw new Error("AI World readiness did not become ready");

  const oauthMetadata = JSON.parse(
    (await get(httpPort, "/.well-known/oauth-authorization-server/oauth", 200)).body,
  );
  if (
    oauthMetadata.issuer !== `${publicOrigin}/oauth` ||
    oauthMetadata.authorization_endpoint !== `${publicOrigin}/oauth/auth` ||
    oauthMetadata.token_endpoint !== `${publicOrigin}/oauth/token` ||
    oauthMetadata.jwks_uri !== `${publicOrigin}/oauth/jwks` ||
    oauthMetadata.registration_endpoint !== `${publicOrigin}/oauth/reg`
  ) {
    throw new Error("OAuth discovery does not preserve the canonical public HTTPS issuer");
  }

  const protectedResource = JSON.parse(
    (await get(httpPort, "/.well-known/oauth-protected-resource/api/mcp", 200)).body,
  );
  if (
    protectedResource.resource !== `${publicOrigin}/api/mcp` ||
    !Array.isArray(protectedResource.authorization_servers) ||
    !protectedResource.authorization_servers.includes(`${publicOrigin}/oauth`)
  ) {
    throw new Error("MCP protected-resource metadata is not bound to the canonical OAuth issuer");
  }

  const jwks = JSON.parse((await get(httpPort, "/oauth/jwks", 200)).body);
  if (!Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.some((key) => key.d)) {
    throw new Error("Public OAuth JWKS must expose at least one public-only signing key");
  }

  const migrated = run(
    [
      ...compose,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "agent_world",
      "-d",
      "agent_world",
      "-Atc",
      "SELECT concat_ws('|', to_regclass('agent_world_oauth.oidc_store'), to_regclass('agent_world_oauth.login_throttle'), to_regclass('agent_world_oauth.account_grants'));",
    ],
    environment,
  ).trim();
  if (
    migrated !==
    "agent_world_oauth.oidc_store|agent_world_oauth.login_throttle|agent_world_oauth.account_grants"
  ) {
    throw new Error("Native Chat OAuth migration set is incomplete");
  }

  const authInspect = JSON.parse(
    run(["inspect", `${project}-native-chat-auth-1`, "--format", "{{json .}}"], environment),
  );
  if (
    authInspect.State?.Health?.Status !== "healthy" ||
    authInspect.HostConfig?.ReadonlyRootfs !== true ||
    authInspect.HostConfig?.PortBindings?.["3002/tcp"]
  ) {
    throw new Error("native-chat-auth container isolation or health contract is incomplete");
  }

  process.stdout.write(
    `${JSON.stringify({ status: "PASS", nativeChatProfile: true, oauthHttpsProxy: true, oauthStorage: true, protectedResource: true, publicJwks: true })}\n`,
  );
} finally {
  run([...compose, "down", "--volumes", "--remove-orphans"], environment, { allowFailure: true });
  run(["image", "rm", `agent-world-web:${imageTag}`], environment, { allowFailure: true });
  run(["image", "rm", `agent-world-native-chat-auth:${imageTag}`], environment, {
    allowFailure: true,
  });
  rmSync(secretDirectory, { recursive: true, force: true });
}
