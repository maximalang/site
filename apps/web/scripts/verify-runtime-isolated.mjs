import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const POSTGRES_IMAGE =
  "postgres:18.3-bookworm@sha256:4b2a518e377fe4cbb67168b8043724634f144cbad35a306c6bab44fced4ec2c7";
const ACK = "AGENT_WORLD_RUNTIME_TEST_ACK";
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const serverDirectory = join(projectRoot, ".next", "standalone", "apps", "web");
const serverFile = join(serverDirectory, "server.js");

if (process.env[ACK] !== "isolated") {
  throw new Error(`${ACK}=isolated is required; the verifier never accepts user infrastructure`);
}

function docker(args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { shell: false, windowsHide: true });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`docker ${args[0]} failed with exit code ${code}`));
      }
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a loopback port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function passwordHash(password) {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 32, {
    N: 32_768,
    r: 8,
    p: 1,
    maxmem: 64 * 1_024 * 1_024,
  });
  return `scrypt-v1$32768$8$1$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

function startRuntimeServer(environment, secrets) {
  const child = spawn(process.execPath, [serverFile], {
    cwd: serverDirectory,
    env: environment,
    shell: false,
    windowsHide: true,
  });
  let output = "";
  const append = (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return {
    child,
    safeOutput: () =>
      secrets.reduce((value, secret) => value.replaceAll(secret, "[redacted]"), output),
  };
}

async function stopRuntimeServer(server) {
  if (server.child.exitCode !== null) return;
  const closed = new Promise((resolve) => server.child.once("close", resolve));
  server.child.kill("SIGTERM");
  await Promise.race([closed, delay(5_000)]);
  if (server.child.exitCode === null) {
    server.child.kill("SIGKILL");
    await closed;
  }
}

async function waitForRuntime(baseUrl, cookie, server) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.child.exitCode !== null) {
      throw new Error(`Standalone server exited before readiness\n${server.safeOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/auth/session`, {
        headers: cookie ? { cookie } : {},
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status !== 503) {
        return response;
      }
    } catch {
      // The loop is bounded and the final error contains redacted server output.
    }
    await delay(500);
  }
  throw new Error(`Standalone server did not become ready\n${server.safeOutput()}`);
}

const suffix = randomBytes(8).toString("hex");
const containerName = `agent-world-runtime-test-${suffix}`;
if (!/^agent-world-runtime-test-[a-f0-9]{16}$/.test(containerName)) {
  throw new Error("Refusing to manage an unexpected Docker container name");
}
const databasePassword = randomBytes(24).toString("base64url");
const ownerPassword = randomBytes(24).toString("base64url");
const ownerHash = passwordHash(ownerPassword);
const csrfSecret = randomBytes(32).toString("base64url");
let database;
let runtimeServer;

try {
  await docker([
    "run",
    "--detach",
    "--name",
    containerName,
    "--tmpfs",
    "/var/lib/postgresql:rw,noexec,nosuid,size=256m",
    "--publish",
    "127.0.0.1::5432",
    "--env",
    `POSTGRES_PASSWORD=${databasePassword}`,
    "--env",
    "POSTGRES_DB=agent_world_runtime_test",
    "--health-cmd",
    "pg_isready -U postgres -d agent_world_runtime_test",
    "--health-interval",
    "1s",
    "--health-timeout",
    "3s",
    "--health-retries",
    "30",
    POSTGRES_IMAGE,
  ]);

  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await docker(["inspect", "--format", "{{.State.Health.Status}}", containerName]);
    if (status === "healthy") {
      healthy = true;
      break;
    }
    await delay(500);
  }
  if (!healthy) throw new Error("Isolated PostgreSQL did not become healthy");
  const portOutput = await docker(["port", containerName, "5432/tcp"]);
  const portMatch = /^127\.0\.0\.1:(\d+)$/.exec(portOutput);
  if (!portMatch) throw new Error("Isolated PostgreSQL was not published on loopback");
  const databasePort = Number.parseInt(portMatch[1], 10);
  const databaseUrl = `postgresql://postgres:${databasePassword}@127.0.0.1:${databasePort}/agent_world_runtime_test`;
  const applicationPort = await freePort();
  const baseUrl = `http://127.0.0.1:${applicationPort}`;
  const environment = {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(applicationPort),
    DATABASE_URL: databaseUrl,
    AGENT_WORLD_DATABASE_TLS: "disable",
    AGENT_WORLD_OWNER_PASSWORD_HASH: ownerHash,
    AGENT_WORLD_CSRF_SECRET: csrfSecret,
  };
  const secrets = [databasePassword, ownerPassword, ownerHash, csrfSecret];

  runtimeServer = startRuntimeServer(environment, secrets);
  const anonymousSession = await waitForRuntime(baseUrl, undefined, runtimeServer);
  if (anonymousSession.status !== 401) {
    throw new Error(`Anonymous session readiness returned ${anonymousSession.status}`);
  }
  const anonymousWorld = await fetch(`${baseUrl}/api/world`);
  if (anonymousWorld.status !== 401) {
    throw new Error(`Anonymous World request returned ${anonymousWorld.status}`);
  }
  const anonymousHub = await fetch(`${baseUrl}/api/hub`);
  if (anonymousHub.status !== 401) {
    throw new Error(`Anonymous Hub request returned ${anonymousHub.status}`);
  }

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ schemaVersion: 1, password: ownerPassword }),
  });
  if (login.status !== 200) {
    const body = (await login.text()).slice(0, 1_000);
    throw new Error(`Owner login returned ${login.status}: ${body}\n${runtimeServer.safeOutput()}`);
  }
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  const loginBody = await login.json();
  if (!cookie?.startsWith("__Host-agent_world_session=") || !loginBody.csrfToken) {
    throw new Error("Owner login did not return the secure session contract");
  }
  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } });
  if (session.status !== 200) throw new Error(`Authenticated session returned ${session.status}`);
  const world = await fetch(`${baseUrl}/api/world`, { headers: { cookie } });
  const worldBody = await world.json();
  if (world.status !== 200 || worldBody.source !== "UNAVAILABLE") {
    throw new Error("Authorized World did not return the bounded no-runtime projection");
  }
  const hub = await fetch(`${baseUrl}/api/hub`, { headers: { cookie } });
  const hubBody = await hub.json();
  const serializedHub = JSON.stringify(hubBody);
  if (
    hub.status !== 200 ||
    hubBody.providers?.length !== 1 ||
    hubBody.accounts?.length !== 0 ||
    hubBody.models?.length !== 0
  ) {
    throw new Error("Authorized Hub did not return the canonical empty-install projection");
  }
  if (/credential|configurationRef|sourceRef|instructions|binding_|session_/.test(serializedHub)) {
    throw new Error("Authorized Hub leaked a private or runtime locator");
  }
  const conversationId = "conversation_11111111-1111-1111-1111-111111111111";
  const agentId = "agent_33333333-3333-3333-3333-333333333333";
  const agentConversations = await fetch(`${baseUrl}/api/agents/${agentId}/conversations`, {
    headers: { cookie },
  });
  if (agentConversations.status !== 404) {
    throw new Error(
      `Missing authorized Agent conversation index returned ${agentConversations.status}`,
    );
  }
  const conversation = await fetch(`${baseUrl}/api/conversations/${conversationId}`, {
    headers: { cookie },
  });
  if (conversation.status !== 404) {
    throw new Error(`Missing authorized Conversation returned ${conversation.status}`);
  }
  const send = await fetch(`${baseUrl}/api/conversations/${conversationId}`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: baseUrl,
      "x-agent-world-csrf": loginBody.csrfToken,
    },
    body: JSON.stringify({
      schemaVersion: 1,
      messageId: "message_22222222-2222-2222-2222-222222222222",
      agentId,
      content: "Verify the runtime boundary.",
    }),
  });
  if (send.status !== 404) throw new Error(`Missing Conversation send returned ${send.status}`);
  const taskBody = JSON.stringify({
    schemaVersion: 1,
    taskId: "task_44444444-4444-4444-4444-444444444444",
    conversationId,
    agentId,
    title: "Verify the runtime boundary",
  });
  const anonymousTask = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: taskBody,
  });
  if (anonymousTask.status !== 401) {
    throw new Error(`Anonymous Task assignment returned ${anonymousTask.status}`);
  }
  const missingTaskTarget = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: baseUrl,
      "x-agent-world-csrf": loginBody.csrfToken,
    },
    body: taskBody,
  });
  const missingTaskBody = await missingTaskTarget.json();
  if (missingTaskTarget.status !== 409 || missingTaskBody.error?.code !== "NO_ACTIVE_SESSION") {
    throw new Error(
      `Task assignment target guard returned ${missingTaskTarget.status}/${String(missingTaskBody.error?.code).slice(0, 64)}`,
    );
  }
  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { cookie, origin: baseUrl, "x-agent-world-csrf": loginBody.csrfToken },
  });
  if (logout.status !== 204) throw new Error(`Owner logout returned ${logout.status}`);
  if ((await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } })).status !== 401) {
    throw new Error("Revoked owner session remained authorized");
  }

  await stopRuntimeServer(runtimeServer);
  runtimeServer = startRuntimeServer(
    {
      ...environment,
      OPENCLAW_GATEWAY_URL: "https://invalid-openclaw.test",
      OPENCLAW_GATEWAY_TOKEN: "invalid-placeholder-token",
    },
    secrets,
  );
  const afterRestart = await waitForRuntime(baseUrl, cookie, runtimeServer);
  if (afterRestart.status !== 401) {
    throw new Error("Revoked owner session became authorized after restart");
  }

  database = new Pool({
    connectionString: databaseUrl,
    ssl: false,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  const evidence = await database.query(
    `SELECT
       (SELECT count(*)::integer FROM agent_world.schema_migrations) AS migrations,
       (SELECT count(*)::integer FROM agent_world.owner_sessions WHERE revoked_at IS NOT NULL) AS revoked_sessions`,
  );
  if (evidence.rows[0]?.migrations !== 7 || evidence.rows[0]?.revoked_sessions !== 1) {
    throw new Error("Standalone runtime did not preserve migration or revocation evidence");
  }

  process.stdout.write(
    `${JSON.stringify({ status: "PASS", postgresImage: POSTGRES_IMAGE, migrations: 7, authLifecycle: true, worldAuth: true, hubAuth: true, conversationAuth: true, agentConversationAuth: true, taskAuth: true, restartRevocation: true, optionalAdapterIsolation: true })}\n`,
  );
} finally {
  if (runtimeServer) await stopRuntimeServer(runtimeServer);
  await database?.end().catch(() => undefined);
  await docker(["rm", "--force", "--volumes", containerName], { allowFailure: true });
}
