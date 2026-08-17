import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const ACK = "AGENT_WORLD_COMPOSE_TEST_ACK";
if (process.env[ACK] !== "isolated") {
  throw new Error(
    `${ACK}=isolated is required; the verifier destroys its disposable Compose project`,
  );
}

const verifierSuffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
const project = `agent-world-verify-${verifierSuffix}`;
const imageTag = `verify-${verifierSuffix}`;
const compose = ["compose", "--project-name", project];
const maxBuffer = 64 * 1024 * 1024;
const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const envFileName = `.env.verify-${verifierSuffix}`;
const backupDirectoryName = `.backups-verify-${verifierSuffix}`;
const bash =
  process.platform === "win32" && existsSync("C:\\Program Files\\Git\\bin\\bash.exe")
    ? "C:\\Program Files\\Git\\bin\\bash.exe"
    : "bash";

function run(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: workspaceRoot,
    env: verifierEnvironment,
    encoding: options.binary ? undefined : "utf8",
    input: options.input,
    maxBuffer,
    windowsHide: true,
  });
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : (result.stderr ?? "");
    throw new Error(
      `docker command failed (${args.slice(0, 4).join(" ")}): ${stderr.slice(-2_000)}`,
    );
  }
  return result.stdout;
}

function hasPublishedPort(inspect, containerPort) {
  const bindings = inspect.HostConfig?.PortBindings?.[containerPort];
  return Array.isArray(bindings) && bindings.some((binding) => Boolean(binding?.HostPort));
}

function runBash(args) {
  const result = spawnSync(bash, args, {
    cwd: workspaceRoot,
    env: verifierEnvironment,
    encoding: "utf8",
    maxBuffer,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`backup command failed (${args[0]}): ${(result.stderr ?? "").slice(-2_000)}`);
  }
  return result.stdout;
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

function get(path, expectedStatus) {
  return new Promise((resolve, reject) => {
    const operation = request(
      {
        host: "127.0.0.1",
        port: Number(verifierEnvironment.AGENT_WORLD_HTTPS_PORT),
        path,
        method: "GET",
        headers: { host: "localhost" },
        rejectUnauthorized: false,
        servername: "localhost",
        timeout: 5_000,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1_024) operation.destroy(new Error(`${path} response is oversized`));
        });
        response.once("end", () => {
          if (response.statusCode !== expectedStatus) {
            reject(
              new Error(`${path} returned ${response.statusCode}, expected ${expectedStatus}`),
            );
            return;
          }
          resolve({ body, headers: response.headers });
        });
      },
    );
    operation.once("timeout", () => operation.destroy(new Error(`${path} timed out`)));
    operation.once("error", reject);
    operation.end();
  });
}

async function waitForReady(expectedStatus, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let error;
  while (Date.now() < deadline) {
    try {
      return await get("/api/health/ready", expectedStatus);
    } catch (caught) {
      error = caught;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw error ?? new Error("Readiness deadline exceeded");
}

const [httpPort, httpsPort] = await Promise.all([reservePort(), reservePort()]);
const verifierEnvironment = {
  ...process.env,
  AGENT_WORLD_POSTGRES_PASSWORD: randomBytes(32).toString("base64url"),
  AGENT_WORLD_CSRF_SECRET: randomBytes(32).toString("base64url"),
  AGENT_WORLD_SECRET_MASTER_KEY: randomBytes(32).toString("base64url"),
  AGENT_WORLD_SECRET_KEY_VERSION: "1",
  AGENT_WORLD_LITELLM_MASTER_KEY: randomBytes(32).toString("base64url"),
  AGENT_WORLD_LITELLM_SALT_KEY: randomBytes(32).toString("base64url"),
  AGENT_WORLD_OWNER_PASSWORD_HASH:
    "scrypt-v1$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  AGENT_WORLD_HTTP_PORT: String(httpPort),
  AGENT_WORLD_HTTPS_PORT: String(httpsPort),
  AGENT_WORLD_IMAGE_TAG: imageTag,
  AGENT_WORLD_CODEX_ACCOUNT_ID: "account_00000000-0000-0000-0000-000000000001",
  AGENT_WORLD_SITE_ADDRESS: "https://localhost",
  AGENT_WORLD_ENV_FILE: envFileName,
  AGENT_WORLD_BACKUP_DIR: backupDirectoryName,
  AGENT_WORLD_RESTORE_ACK: "replace-database",
  COMPOSE_PROJECT_NAME: project,
};

writeFileSync(
  new URL(`../${envFileName}`, import.meta.url),
  [
    `AGENT_WORLD_POSTGRES_PASSWORD=${verifierEnvironment.AGENT_WORLD_POSTGRES_PASSWORD}`,
    `AGENT_WORLD_CSRF_SECRET=${verifierEnvironment.AGENT_WORLD_CSRF_SECRET}`,
    `AGENT_WORLD_SECRET_MASTER_KEY=${verifierEnvironment.AGENT_WORLD_SECRET_MASTER_KEY}`,
    `AGENT_WORLD_SECRET_KEY_VERSION=${verifierEnvironment.AGENT_WORLD_SECRET_KEY_VERSION}`,
    `AGENT_WORLD_LITELLM_MASTER_KEY=${verifierEnvironment.AGENT_WORLD_LITELLM_MASTER_KEY}`,
    `AGENT_WORLD_LITELLM_SALT_KEY=${verifierEnvironment.AGENT_WORLD_LITELLM_SALT_KEY}`,
    `AGENT_WORLD_OWNER_PASSWORD_HASH='${verifierEnvironment.AGENT_WORLD_OWNER_PASSWORD_HASH}'`,
    `AGENT_WORLD_HTTP_PORT=${verifierEnvironment.AGENT_WORLD_HTTP_PORT}`,
    `AGENT_WORLD_HTTPS_PORT=${verifierEnvironment.AGENT_WORLD_HTTPS_PORT}`,
    `AGENT_WORLD_IMAGE_TAG=${imageTag}`,
    `AGENT_WORLD_CODEX_ACCOUNT_ID=${verifierEnvironment.AGENT_WORLD_CODEX_ACCOUNT_ID}`,
    "AGENT_WORLD_SITE_ADDRESS=https://localhost",
    "",
  ].join("\n"),
  { encoding: "utf8", mode: 0o600 },
);

try {
  run([...compose, "config", "--quiet"]);
  run([...compose, "up", "-d", "--build", "--wait", "--wait-timeout", "120"]);
  const live = await get("/api/health/live", 200);
  const ready = await get("/api/health/ready", 200);
  if (
    live.body !== '{"status":"alive"}' ||
    ready.body !== '{"status":"ready"}' ||
    !live.headers["strict-transport-security"] ||
    live.headers.server
  ) {
    throw new Error("HTTPS security-header contract is incomplete");
  }

  const webInspect = JSON.parse(run(["inspect", `${project}-web-1`, "--format", "{{json .}}"]));
  const postgresInspect = JSON.parse(
    run(["inspect", `${project}-postgres-1`, "--format", "{{json .}}"]),
  );
  const liteLlmInspect = JSON.parse(
    run(["inspect", `${project}-litellm-1`, "--format", "{{json .}}"]),
  );
  const codexWorkerInspect = JSON.parse(
    run(["inspect", `${project}-codex-worker-1`, "--format", "{{json .}}"]),
  );
  const codexWorkerHealth = JSON.parse(
    run([
      ...compose,
      "exec",
      "-T",
      "codex-worker",
      "node",
      "-e",
      "fetch('http://127.0.0.1:3100/health').then(async r=>process.stdout.write(await r.text()))",
    ]),
  );
  const codexVersion = run([...compose, "exec", "-T", "codex-worker", "codex", "--version"]).trim();
  const codexCaBundle = run([
    ...compose,
    "exec",
    "-T",
    "codex-worker",
    "test",
    "-s",
    "/etc/ssl/certs/ca-certificates.crt",
  ]);
  const isolationChecks = {
    "web uses the expected non-root UID": webInspect.Config.User === "10001:10001",
    "web root filesystem is read-only": webInspect.HostConfig.ReadonlyRootfs === true,
    "web drops all capabilities": webInspect.HostConfig.CapDrop?.includes("ALL") === true,
    "web port 3000 has no host binding": !hasPublishedPort(webInspect, "3000/tcp"),
    "PostgreSQL port 5432 has no host binding": !hasPublishedPort(postgresInspect, "5432/tcp"),
    "LiteLLM uses the expected non-root UID": liteLlmInspect.Config.User === "10001:10001",
    "LiteLLM root filesystem is read-only": liteLlmInspect.HostConfig.ReadonlyRootfs === true,
    "LiteLLM drops all capabilities": liteLlmInspect.HostConfig.CapDrop?.includes("ALL") === true,
    "LiteLLM port 4000 has no host binding": !hasPublishedPort(liteLlmInspect, "4000/tcp"),
    "Codex worker uses the expected non-root UID": codexWorkerInspect.Config.User === "10002:10002",
    "Codex worker root filesystem is read-only": codexWorkerInspect.HostConfig.ReadonlyRootfs === true,
    "Codex worker drops all capabilities": codexWorkerInspect.HostConfig.CapDrop?.includes("ALL") === true,
    "Codex worker port 3100 has no host binding": !hasPublishedPort(codexWorkerInspect, "3100/tcp"),
    "Codex worker is not attached to the edge network":
      codexWorkerInspect.NetworkSettings.Networks[`${project}_edge`] === undefined,
    "Codex worker process is available": codexWorkerHealth.status === "available",
    "Codex authentication remains unavailable without owner login":
      codexWorkerHealth.authentication === "UNAVAILABLE",
    "Codex CLI version is pinned": codexVersion === "codex-cli 0.147.0",
  };
  const failedIsolationChecks = Object.entries(isolationChecks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failedIsolationChecks.length > 0) {
    throw new Error(
      `Container isolation contract is incomplete: ${failedIsolationChecks.join("; ")}`,
    );
  }

  run([
    ...compose,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "agent_world",
    "-d",
    "agent_world",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "CREATE TABLE agent_world.backup_restore_probe (marker text PRIMARY KEY); INSERT INTO agent_world.backup_restore_probe VALUES ('before-backup');",
  ]);
  const backupPath = runBash(["ops/backup.sh"]).trim();
  if (!backupPath) throw new Error("Backup path is empty");
  run([
    ...compose,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "agent_world",
    "-d",
    "agent_world",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "UPDATE agent_world.backup_restore_probe SET marker='after-backup';",
  ]);
  runBash(["ops/restore.sh", backupPath]);
  await waitForReady(200);
  const marker = run([
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
    "SELECT marker FROM agent_world.backup_restore_probe;",
  ]).trim();
  if (marker !== "before-backup") throw new Error("Backup/restore marker did not roll back");

  run([...compose, "stop", "postgres"]);
  await get("/api/health/live", 200);
  await waitForReady(503);
  run([...compose, "start", "postgres"]);
  await waitForReady(200);

  process.stdout.write(
    `${JSON.stringify({ status: "PASS", project, https: true, readinessDegradation: true, backupRestore: true, nonRoot: true, readOnly: true, privateDatabase: true, privateModelGateway: true, privateCodexWorker: true, codexAuthenticationSeparated: true, codexCaBundle: codexCaBundle === "", codexCliVersion: "0.147.0" })}\n`,
  );
} finally {
  run([...compose, "down", "--volumes", "--remove-orphans"], { allowFailure: true });
  run(["image", "rm", `agent-world-web:${imageTag}`], { allowFailure: true });
  run(["image", "rm", `agent-world-codex-worker:${imageTag}`], { allowFailure: true });
  rmSync(new URL(`../${envFileName}`, import.meta.url), { force: true });
  rmSync(new URL(`../${backupDirectoryName}`, import.meta.url), { force: true, recursive: true });
}
