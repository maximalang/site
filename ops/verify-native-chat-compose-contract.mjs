import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const randomSecret = () => randomBytes(32).toString("base64url");
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
};

const result = spawnSync(
  "docker",
  ["compose", "--profile", "native-chat", "config", "--format", "json"],
  {
    cwd: workspaceRoot,
    env: environment,
    encoding: "utf8",
    windowsHide: true,
  },
);
if (result.status !== 0) {
  throw new Error(`docker compose config failed: ${(result.stderr ?? "").slice(-2_000)}`);
}

const config = JSON.parse(result.stdout);
const auth = config.services?.["native-chat-auth"];
const web = config.services?.web;
if (!auth || !web) throw new Error("native-chat profile must include web and native-chat-auth");
if (auth.depends_on?.web?.condition !== "service_healthy") {
  throw new Error(
    "native-chat-auth must wait for healthy web because web applies canonical PostgreSQL migrations",
  );
}
if (auth.depends_on?.postgres?.condition !== "service_healthy") {
  throw new Error("native-chat-auth must retain a healthy PostgreSQL dependency");
}
if (web.depends_on?.["native-chat-auth"]) {
  throw new Error("web must not depend on native-chat-auth; that would create a startup cycle");
}

const caddyfile = readFileSync(new URL("./Caddyfile", import.meta.url), "utf8");
const oauthProxyBlocks = [...caddyfile.matchAll(/reverse_proxy native-chat-auth:3002 \{([^}]*)\}/g)];
if (oauthProxyBlocks.length !== 2) {
  throw new Error("Caddy must expose exactly two managed native-chat-auth proxy blocks");
}
for (const [, body] of oauthProxyBlocks) {
  if (!/header_up\s+X-Forwarded-Proto\s+https/.test(body)) {
    throw new Error(
      "Every native-chat-auth proxy block must force the canonical public HTTPS scheme",
    );
  }
}

process.stdout.write(
  `${JSON.stringify({ status: "PASS", nativeChatMigrationOrdering: true, oauthProxyScheme: "https" })}\n`,
);
