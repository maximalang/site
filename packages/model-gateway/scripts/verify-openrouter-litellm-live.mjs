import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { LiteLlmModelGateway, LiteLlmProjectionReconciler } from "../dist/index.js";

if (process.env.AGENT_WORLD_LITELLM_LIVE_TEST_ACK !== "isolated") {
  throw new Error(
    "Set AGENT_WORLD_LITELLM_LIVE_TEST_ACK=isolated to run the disposable LiteLLM verifier",
  );
}

const execFileAsync = promisify(execFile);
const IMAGE =
  "ghcr.io/berriai/litellm@sha256:154e23bb5f31b1f10e16392a8ef299bd2cde08de3a64a6849002cfcc25ce3c63";
const POSTGRES_IMAGE =
  "pgvector/pgvector:0.8.6-pg18-bookworm@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a";
const routeId = "model_route_77777777-7777-7777-7777-777777777777";
const modelAlias = `route-${routeId}`;
const providerModel = "openrouter/anthropic/test-model";
const remoteModelId = "anthropic/test-model";
const containerName = `agent-world-openrouter-litellm-${process.pid}-${Date.now()}`;
const postgresName = `${containerName}-postgres`;
const networkName = `${containerName}-network`;
const tempDirectory = await mkdtemp(path.join(tmpdir(), "agent-world-openrouter-litellm-"));
const configPath = path.join(tempDirectory, "config.yaml");
const logs = [];
const observed = [];

const upstream = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/api/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1_000_000) {
      response.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  observed.push({ authorization: request.headers.authorization, body, url: request.url });
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      id: "chatcmpl-openrouter-contract",
      object: "chat.completion",
      created: 1_786_622_400,
      model: remoteModelId,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: "openrouter mapping verified" },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }),
  );
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const { stdout } = await execFileAsync("docker", [
        "inspect",
        "--format",
        "{{.State.Health.Status}}",
        postgresName,
      ]);
      if (stdout.trim() === "healthy") return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for OpenRouter verifier PostgreSQL");
}

let container;
async function waitForPublishedPort(deadline) {
  while (Date.now() < deadline) {
    if (container?.exitCode !== null && container?.exitCode !== undefined) {
      throw new Error(
        `LiteLLM exited before publishing its port (${container.exitCode})\n${logs.slice(-80).join("")}`,
      );
    }
    try {
      const { stdout } = await execFileAsync("docker", ["port", containerName, "4000/tcp"]);
      const match = stdout.match(/127\.0\.0\.1:(\d+)/);
      if (match) return Number(match[1]);
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for LiteLLM published port\n${logs.slice(-80).join("")}`);
}

async function waitForReady(gateway, deadline) {
  while (Date.now() < deadline) {
    const health = await gateway.health();
    if (health.status === "READY") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for LiteLLM readiness\n${logs.slice(-80).join("")}`);
}

try {
  const upstreamPort = await listen(upstream);
  await execFileAsync("docker", ["network", "create", networkName]);
  await execFileAsync("docker", [
    "run",
    "-d",
    "--name",
    postgresName,
    "--network",
    networkName,
    "-e",
    "POSTGRES_PASSWORD=litellm-openrouter-postgres-password",
    "-e",
    "POSTGRES_DB=litellm",
    "--health-cmd",
    "pg_isready -U postgres -d litellm",
    "--health-interval",
    "1s",
    "--health-timeout",
    "3s",
    "--health-retries",
    "30",
    POSTGRES_IMAGE,
  ]);
  await waitForPostgres();
  await writeFile(
    configPath,
    `model_list:
  - model_name: seed-local-model
    litellm_params:
      model: openai/seed-local-model
      api_base: os.environ/TEST_OPENROUTER_API_BASE
      api_key: os.environ/TEST_OPENROUTER_API_KEY
      num_retries: 0
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
router_settings:
  num_retries: 0
`,
    { encoding: "utf8", mode: 0o644 },
  );
  container = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      containerName,
      "--network",
      networkName,
      "--add-host",
      "host.docker.internal:host-gateway",
      "--user",
      "10001:10001",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=64m",
      "--memory",
      "1536m",
      "--cpus",
      "1.0",
      "--pids-limit",
      "256",
      "-p",
      "127.0.0.1::4000",
      "-v",
      `${configPath}:/app/config.yaml:ro`,
      "-e",
      `TEST_OPENROUTER_API_BASE=http://host.docker.internal:${upstreamPort}/api/v1`,
      "-e",
      "TEST_OPENROUTER_API_KEY=loopback-openrouter-key",
      "-e",
      "LITELLM_MASTER_KEY=litellm-openrouter-master-key",
      "-e",
      "LITELLM_SALT_KEY=litellm-openrouter-salt-key-32-bytes-minimum",
      "-e",
      `DATABASE_URL=postgresql://postgres:litellm-openrouter-postgres-password@${postgresName}:5432/litellm`,
      "-e",
      "STORE_MODEL_IN_DB=True",
      "-e",
      "LITELLM_LOCAL_MODEL_COST_MAP=True",
      IMAGE,
      "--config",
      "/app/config.yaml",
      "--host",
      "0.0.0.0",
      "--port",
      "4000",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  container.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  container.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));

  const proxyPort = await waitForPublishedPort(Date.now() + 30_000);
  const gateway = new LiteLlmModelGateway({
    baseUrl: `http://127.0.0.1:${proxyPort}`,
    credentialProvider: async () => "litellm-openrouter-master-key",
    routeResolver: async (requestedRouteId) => ({
      modelRouteId: requestedRouteId,
      modelAlias,
    }),
  });
  await waitForReady(gateway, Date.now() + 90_000);

  const reconciler = new LiteLlmProjectionReconciler({
    baseUrl: `http://127.0.0.1:${proxyPort}`,
    credentialProvider: async () => "litellm-openrouter-master-key",
  });
  const reconciliation = await reconciler.reconcile({
    modelRouteId: routeId,
    modelAlias,
    providerModel,
    apiBase: `http://host.docker.internal:${upstreamPort}/api/v1`,
    credential: "loopback-openrouter-key",
  });
  assert.equal(reconciliation.outcome, "CREATED");

  const result = await gateway.complete({
    schemaVersion: 1,
    runId: "run_88888888-8888-8888-8888-888888888888",
    modelRouteId: routeId,
    messages: [{ role: "USER", content: "verify OpenRouter mapping" }],
    maxOutputTokens: 16,
    temperature: 0,
    timeoutMs: 30_000,
    idempotencyKey: "openrouter-litellm-live-contract-1",
  });

  assert.equal(result.content, "openrouter mapping verified");
  assert.equal(result.upstreamRequestId, "chatcmpl-openrouter-contract");
  assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 3, totalTokens: 8 });
  assert.equal(observed.length, 1);
  assert.equal(observed[0].url, "/api/v1/chat/completions");
  assert.equal(observed[0].authorization, "Bearer loopback-openrouter-key");
  assert.equal(observed[0].body.model, remoteModelId);
  assert.deepEqual(observed[0].body.messages, [
    { role: "user", content: "verify OpenRouter mapping" },
  ]);
  assert.equal(JSON.stringify(observed).includes("openrouter/openrouter/"), false);

  console.log(
    `OpenRouter LiteLLM mapping verified: ${providerModel} -> ${remoteModelId} at /api/v1/chat/completions`,
  );
} finally {
  if (container && container.exitCode === null) container.kill("SIGTERM");
  await Promise.allSettled([
    execFileAsync("docker", ["rm", "-f", containerName]),
    execFileAsync("docker", ["rm", "-f", postgresName]),
  ]);
  await Promise.allSettled([execFileAsync("docker", ["network", "rm", networkName])]);
  await close(upstream).catch(() => undefined);
  await rm(tempDirectory, { recursive: true, force: true });
}