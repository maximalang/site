import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { LiteLlmModelGateway, ModelGatewayFailure } from "../dist/index.js";

if (process.env.AGENT_WORLD_LITELLM_LIVE_TEST_ACK !== "isolated") {
  throw new Error(
    "Set AGENT_WORLD_LITELLM_LIVE_TEST_ACK=isolated to run the disposable LiteLLM verifier",
  );
}

const execFileAsync = promisify(execFile);
const IMAGE =
  "ghcr.io/berriai/litellm@sha256:154e23bb5f31b1f10e16392a8ef299bd2cde08de3a64a6849002cfcc25ce3c63";
const routeId = "model_route_22222222-2222-2222-2222-222222222222";
const modelAlias = "route-model_route_22222222";
const containerName = `agent-world-litellm-${process.pid}-${Date.now()}`;
const tempDirectory = await mkdtemp(path.join(tmpdir(), "agent-world-litellm-"));
const configPath = path.join(tempDirectory, "config.yaml");
let upstreamMode = "success";
let upstreamRequests = 0;
const logs = [];

const upstream = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
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
  upstreamRequests += 1;
  assert.equal(request.headers.authorization, "Bearer loopback-provider-key");
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.equal(body.model, "local-test");
  assert.deepEqual(body.messages, [{ role: "user", content: "live contract" }]);
  if (upstreamMode === "rate-limited") {
    response.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
    response.end(JSON.stringify({ error: { message: "deterministic limit", type: "rate_limit" } }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      id: "chatcmpl-live-contract",
      object: "chat.completion",
      created: 1_786_622_400,
      model: "local-test",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: "live gateway reply" },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
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

async function waitForPublishedPort(deadline) {
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync("docker", ["port", containerName, "4000/tcp"]);
      const match = stdout.match(/127\.0\.0\.1:(\d+)/);
      if (match) return Number(match[1]);
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for LiteLLM published port");
}

async function waitForReady(gateway, deadline) {
  while (Date.now() < deadline) {
    const health = await gateway.health();
    if (health.status === "READY") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for LiteLLM readiness\n${logs.slice(-80).join("")}`);
}

let container;
try {
  const upstreamPort = await listen(upstream);
  await writeFile(
    configPath,
    `model_list:
  - model_name: ${modelAlias}
    litellm_params:
      model: openai/local-test
      api_base: os.environ/TEST_OPENAI_API_BASE
      api_key: os.environ/TEST_OPENAI_API_KEY
      num_retries: 0
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
router_settings:
  num_retries: 0
`,
    { encoding: "utf8", mode: 0o600 },
  );
  container = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      containerName,
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
      "768m",
      "--cpus",
      "1.0",
      "--pids-limit",
      "256",
      "-p",
      "127.0.0.1::4000",
      "-v",
      `${configPath}:/app/config.yaml:ro`,
      "-e",
      `TEST_OPENAI_API_BASE=http://host.docker.internal:${upstreamPort}/v1`,
      "-e",
      "TEST_OPENAI_API_KEY=loopback-provider-key",
      "-e",
      "LITELLM_MASTER_KEY=litellm-live-master-key",
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
    credentialProvider: async () => "litellm-live-master-key",
    routeResolver: async (requestedRouteId) => ({
      modelRouteId: requestedRouteId,
      modelAlias,
    }),
  });
  await waitForReady(gateway, Date.now() + 90_000);
  const request = {
    schemaVersion: 1,
    runId: "run_11111111-1111-1111-1111-111111111111",
    modelRouteId: routeId,
    messages: [{ role: "USER", content: "live contract" }],
    maxOutputTokens: 64,
    temperature: 0,
    timeoutMs: 30_000,
    idempotencyKey: "litellm-live-contract-1",
  };
  const result = await gateway.complete(request);
  assert.equal(result.content, "live gateway reply");
  assert.equal(result.upstreamRequestId, "chatcmpl-live-contract");
  assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 4, totalTokens: 9 });

  upstreamMode = "rate-limited";
  const failure = await gateway.complete(request).catch((error) => error);
  assert(failure instanceof ModelGatewayFailure);
  assert.equal(failure.code, "RATE_LIMITED");
  assert.equal(failure.retryable, true);
  assert(upstreamRequests >= 2);

  const { stdout: inspectOutput } = await execFileAsync("docker", ["inspect", containerName]);
  const inspection = JSON.parse(inspectOutput)[0];
  assert.equal(inspection.Config.User, "10001:10001");
  assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(inspection.HostConfig.CapDrop, ["ALL"]);
  assert.equal(inspection.HostConfig.Memory, 805_306_368);
  assert.equal(inspection.HostConfig.PidsLimit, 256);
  console.log(
    JSON.stringify({
      status: "PASS",
      image: IMAGE,
      release: "v1.96.2",
      completion: true,
      rateLimitNormalization: true,
      upstreamRequests,
      user: inspection.Config.User,
      readOnly: inspection.HostConfig.ReadonlyRootfs,
    }),
  );
} finally {
  await execFileAsync("docker", ["rm", "-f", containerName]).catch(() => undefined);
  if (container && container.exitCode === null) container.kill();
  await close(upstream).catch(() => undefined);
  await rm(tempDirectory, { recursive: true, force: true });
}
