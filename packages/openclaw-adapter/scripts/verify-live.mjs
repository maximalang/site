import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenClawReadAdapter, OpenClawWriteAdapter } from "../dist/index.js";

const ACK = "AGENT_WORLD_OPENCLAW_LIVE_TEST_ACK";
if (process.env[ACK] !== "isolated") {
  throw new Error(
    `${ACK}=isolated is required; the verifier creates disposable local infrastructure`,
  );
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Loopback test server did not expose a TCP port"));
        return;
      }
      resolveListen(address.port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function reservePort() {
  const server = createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

function stopChild(child) {
  if (child.exitCode !== null) return Promise.resolve();
  child.kill("SIGTERM");
  return new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

async function waitForPort(port, child, output) {
  // The pinned CLI initializes its extension/runtime graph before the HTTP
  // listener. Keep this separate from the protocol client's retry budget.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Pinned OpenClaw Gateway exited before readiness: ${output().slice(-2_000)}`);
    }
    const ready = await new Promise((resolveReady) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolveReady(true);
      });
      socket.once("error", () => resolveReady(false));
      socket.setTimeout(500, () => {
        socket.destroy();
        resolveReady(false);
      });
    });
    if (ready) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(
    `Pinned OpenClaw Gateway did not open its loopback port: ${output().slice(-2_000)}`,
  );
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const openClawBin = join(root, "node_modules", "openclaw", "openclaw.mjs");
const disposableRoot = await mkdtemp(join(tmpdir(), "agent-world-openclaw-live-"));
const stateDir = join(disposableRoot, "state");
const workspaceDir = join(disposableRoot, "workspace");
const configPath = join(disposableRoot, "openclaw.json");
const gatewayPort = await reservePort();
const gatewayToken = randomBytes(32).toString("base64url");
let modelRequests = 0;

const modelServer = createServer((request, response) => {
  if (request.url === "/v1/models") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: [{ id: "test-model", object: "model" }] }));
    return;
  }
  if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
    response.writeHead(404).end();
    return;
  }
  modelRequests += 1;
  let bytes = 0;
  request.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 1_000_000) request.destroy();
  });
  request.on("end", () => {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const created = Math.floor(Date.now() / 1_000);
    const chunk = (delta, finishReason = null) =>
      `data: ${JSON.stringify({
        id: "chatcmpl-live-proof",
        object: "chat.completion.chunk",
        created,
        model: "test-model",
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`;
    response.write(chunk({ role: "assistant" }));
    response.write(chunk({ content: "LIVE_OPENCLAW_ROUND_TRIP_OK" }));
    response.write(chunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
});

let gateway;
try {
  const modelPort = await listen(modelServer);
  await mkdir(stateDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  const config = {
    gateway: { mode: "local", bind: "loopback", port: gatewayPort },
    agents: {
      defaults: {
        workspace: workspaceDir,
        model: { primary: "live-proof/test-model" },
      },
      entries: {
        researcher: {
          name: "Researcher",
          workspace: workspaceDir,
          model: { primary: "live-proof/test-model" },
        },
      },
    },
    models: {
      providers: {
        "live-proof": {
          baseUrl: `http://127.0.0.1:${modelPort}/v1`,
          apiKey: "disposable-test-key",
          api: "openai-completions",
          request: { allowPrivateNetwork: true },
          models: [
            {
              id: "test-model",
              name: "Disposable live proof model",
              contextWindow: 8_192,
              maxTokens: 512,
            },
          ],
        },
      },
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8" });
  await chmod(configPath, 0o600);

  gateway = spawn(
    process.execPath,
    [
      openClawBin,
      "gateway",
      "run",
      "--port",
      String(gatewayPort),
      "--bind",
      "loopback",
      "--auth",
      "token",
      "--token",
      gatewayToken,
      "--ws-log",
      "compact",
    ],
    {
      cwd: disposableRoot,
      env: {
        ...process.env,
        NO_COLOR: "1",
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_STATE_DIR: stateDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let gatewayOutput = "";
  gateway.stdout.setEncoding("utf8");
  gateway.stderr.setEncoding("utf8");
  gateway.stdout.on("data", (chunk) => {
    gatewayOutput = `${gatewayOutput}${chunk}`.slice(-16_384);
  });
  gateway.stderr.on("data", (chunk) => {
    gatewayOutput = `${gatewayOutput}${chunk}`.slice(-16_384);
  });
  await waitForPort(gatewayPort, gateway, () => gatewayOutput);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));

  const telemetry = [];
  const adapter = new OpenClawWriteAdapter({
    config: {
      endpoint: `ws://127.0.0.1:${gatewayPort}`,
      clientVersion: "0.0.0-live-proof",
      instanceId: `live-proof-${randomUUID()}`,
    },
    credentialProvider: async () => ({ kind: "TOKEN", value: gatewayToken }),
    telemetry: { record: (event) => telemetry.push(event) },
    correlationId: "isolated-live-proof",
  });
  // The official client uses a 15 second connect-challenge timeout followed by
  // exponential reconnect. One failed challenge plus a successful retry must
  // fit inside the verifier's readiness window.
  const deadline = Date.now() + 75_000;
  while (adapter.state !== "READY" && Date.now() < deadline) {
    if (gateway.exitCode !== null) {
      throw new Error(
        `Pinned OpenClaw Gateway exited before readiness: ${gatewayOutput.slice(-2_000)}`,
      );
    }
    if (adapter.state === "IDLE") await adapter.start();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (adapter.state !== "READY") {
    throw new Error(
      `Pinned OpenClaw Gateway did not become ready: ${JSON.stringify(telemetry).slice(-2_000)} ${gatewayOutput.slice(-2_000)}`,
    );
  }
  const receipt = await adapter.executeTask({
    runId: "run_11111111-1111-1111-1111-111111111111",
    taskId: "task_11111111-1111-1111-1111-111111111111",
    agentId: "agent_22222222-2222-2222-2222-222222222222",
    bindingId: "binding_33333333-3333-3333-3333-333333333333",
    sessionId: "session_44444444-4444-4444-4444-444444444444",
    externalAgentId: "researcher",
    externalSessionRef: "agent:researcher:agent-world-live-proof",
    title: "Return the live proof marker",
    description: "Reply with the exact requested marker.",
    idempotencyKey: "run:11111111-1111-1111-1111-111111111111",
  });
  const terminal = await adapter.waitForTask(receipt.externalRunId, 20_000);
  if (terminal.status !== "COMPLETED" || modelRequests !== 1) {
    throw new Error("Pinned OpenClaw did not complete exactly one real model-backed agent turn");
  }
  if (
    !telemetry.some(
      (event) => event.event === "openclaw_write_authority_checked" && event.outcome === "ACCEPTED",
    ) ||
    !telemetry.some(
      (event) => event.event === "openclaw_task_wait_completed" && event.outcome === "COMPLETED",
    )
  ) {
    throw new Error(
      "Pinned OpenClaw live proof is missing bounded handshake or terminal telemetry",
    );
  }
  const readTelemetry = [];
  const snapshots = [];
  const histories = [];
  const readAdapter = new OpenClawReadAdapter({
    config: {
      endpoint: `ws://127.0.0.1:${gatewayPort}`,
      clientVersion: "0.0.0-live-proof",
      instanceId: `live-proof-read-${randomUUID()}`,
    },
    bindings: [
      {
        agentId: "agent_22222222-2222-2222-2222-222222222222",
        bindingId: "binding_33333333-3333-3333-3333-333333333333",
        externalAgentId: "researcher",
        displayName: "Researcher",
      },
    ],
    credentialProvider: async () => ({ kind: "TOKEN", value: gatewayToken }),
    telemetry: { record: (event) => readTelemetry.push(event) },
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    messageSessions: [
      {
        conversationId: "conversation_55555555-5555-5555-5555-555555555555",
        sessionId: "session_44444444-4444-4444-4444-444444444444",
        agentId: "agent_22222222-2222-2222-2222-222222222222",
        bindingId: "binding_33333333-3333-3333-3333-333333333333",
        externalAgentId: "researcher",
        externalSessionKey: "agent:researcher:agent-world-live-proof",
      },
    ],
    onReceivedHistory: (history) => histories.push(history),
    correlationId: "isolated-live-read-proof",
  });
  await readAdapter.start();
  const readDeadline = Date.now() + 20_000;
  while (readAdapter.state !== "READY" && Date.now() < readDeadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  await readAdapter.stop();
  await adapter.stop();
  if (
    snapshots.length === 0 ||
    histories.length === 0 ||
    !histories.some((history) =>
      history.messages.some((message) => message.content.includes("LIVE_OPENCLAW_ROUND_TRIP_OK")),
    ) ||
    !readTelemetry.some(
      (event) => event.event === "openclaw_sync_completed" && event.outcome === "SUCCEEDED",
    )
  ) {
    throw new Error(
      `Pinned OpenClaw read handshake or canonical transcript round trip failed: ${JSON.stringify(readTelemetry).slice(-2_000)}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", openclawVersion: "2026.8.1-beta.1", protocol: 4, readHandshake: true, writeHandshake: true, agentRpc: true, agentWait: true, transcriptRoundTrip: true, modelRequests })}\n`,
  );
} finally {
  if (gateway) await stopChild(gateway);
  await closeServer(modelServer).catch(() => undefined);
  await rm(disposableRoot, { recursive: true, force: true });
}
