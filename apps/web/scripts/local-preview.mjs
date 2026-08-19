import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { resolve } from "node:path";
import process from "node:process";

const PREVIEW_HOST = "127.0.0.1";
const PREVIEW_PORT = 3210;
const BACKEND_PORT = 3211;
const root = resolve(import.meta.dirname, "../../..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const previewUrl = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`;
const backendUrl = `http://${PREVIEW_HOST}:${BACKEND_PORT}`;
const csrfToken = "p".repeat(43);
const generatedAt = "2026-08-19T19:45:00.000Z";
const projectId = "project_33333333-3333-3333-3333-333333333333";
const researchAgentId = "agent_11111111-1111-1111-1111-111111111111";
const reviewerAgentId = "agent_22222222-2222-2222-2222-222222222222";
const conversationId = "conversation_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} exited with ${code ?? signal ?? "unknown status"}`));
      }
    });
  });
}

async function ensureWorkspace() {
  if (!existsSync(resolve(root, "node_modules", ".package-lock.json"))) {
    console.log("[preview] Installing the pinned workspace once...");
    await run(npm, ["ci", "--ignore-scripts"]);
  }
  console.log("[preview] Building TypeScript project references...");
  await run(npm, ["exec", "--", "tsc", "-b"]);
}

async function buildFixtures() {
  const {
    AgentConversationListSchema,
    ConversationReadModelSchema,
    ExecutionPreferenceLayerSchema,
    ExecutionPreferenceReadModelSchema,
    HubReadModelSchema,
    OperationsReadModelSchema,
    buildWorldReadModel,
    resolveExecutionPreferences,
  } = await import("@agent-world/read-model");

  const world = buildWorldReadModel({
    source: "CONTRACT_FIXTURE",
    generatedAt,
    agents: [
      {
        schemaVersion: 1,
        id: researchAgentId,
        slug: "researcher",
        displayName: "Research Lead",
        role: "Evidence-first research",
        instructions: "Find sources and preserve provenance.",
        isEnabled: true,
      },
      {
        schemaVersion: 1,
        id: reviewerAgentId,
        slug: "reviewer",
        displayName: "Reviewer",
        role: "Independent review",
        instructions: "Review claims against primary sources.",
        isEnabled: true,
      },
    ],
    tasks: [
      {
        schemaVersion: 1,
        id: "task_44444444-4444-4444-4444-444444444444",
        projectId,
        assigneeAgentId: researchAgentId,
        title: "Verify protocol contract",
        approvalRequirement: "NOT_REQUIRED",
        idempotencyKey: "preview:task:protocol-contract",
        createdAt: "2026-08-19T19:40:00.000Z",
      },
      {
        schemaVersion: 1,
        id: "task_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        projectId,
        assigneeAgentId: reviewerAgentId,
        title: "Review protocol contract",
        approvalRequirement: "REQUIRED",
        idempotencyKey: "preview:task:review-protocol-contract",
        createdAt: "2026-08-19T19:42:00.000Z",
      },
    ],
    handoffs: [
      {
        id: "event_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        missionId: "mission_cccccccc-cccc-cccc-cccc-cccccccccccc",
        fromTaskId: "task_44444444-4444-4444-4444-444444444444",
        toTaskId: "task_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        fromRunId: "run_dddddddd-dddd-dddd-dddd-dddddddddddd",
        fromAgentId: researchAgentId,
        toAgentId: reviewerAgentId,
        occurredAt: "2026-08-19T19:42:30.000Z",
      },
    ],
    events: [
      {
        schemaVersion: 1,
        id: "event_55555555-5555-5555-5555-555555555555",
        sequence: 1,
        occurredAt: "2026-08-19T19:40:30.000Z",
        source: { kind: "DOMAIN", actor: "OWNER", commandId: "preview:assign" },
        eventType: "TASK_ASSIGNED",
        payload: {
          taskId: "task_44444444-4444-4444-4444-444444444444",
          agentId: researchAgentId,
        },
      },
      {
        schemaVersion: 1,
        id: "event_66666666-6666-6666-6666-666666666666",
        sequence: 2,
        occurredAt: "2026-08-19T19:41:00.000Z",
        source: {
          kind: "RUNTIME",
          adapterKind: "OPENCLAW",
          bindingId: "binding_88888888-8888-8888-8888-888888888888",
          externalEventId: "preview-runtime-1",
        },
        eventType: "AGENT_STATUS_CHANGED",
        payload: {
          agentId: researchAgentId,
          status: "RUNNING",
          taskId: "task_44444444-4444-4444-4444-444444444444",
        },
      },
      {
        schemaVersion: 1,
        id: "event_77777777-7777-7777-7777-777777777777",
        sequence: 3,
        occurredAt: "2026-08-19T19:42:00.000Z",
        source: {
          kind: "RUNTIME",
          adapterKind: "OPENCLAW",
          bindingId: "binding_99999999-9999-9999-9999-999999999999",
          externalEventId: "preview-runtime-2",
        },
        eventType: "AGENT_STATUS_CHANGED",
        payload: { agentId: reviewerAgentId, status: "IDLE" },
      },
    ],
  });

  const hub = HubReadModelSchema.parse({
    schemaVersion: 1,
    generatedAt,
    providers: [
      {
        providerId: "provider_10101010-1010-1010-1010-101010101010",
        slug: "openai",
        displayName: "OpenAI",
        kind: "OPENAI",
        category: "LLM_API",
        isEnabled: true,
      },
    ],
    accounts: [
      {
        accountId: "account_11111111-1111-1111-1111-111111111111",
        providerId: "provider_10101010-1010-1010-1010-101010101010",
        label: "OpenAI owner API",
        authMechanism: "API_KEY",
        availableSurfaces: ["API"],
        health: "UNCONFIGURED",
        isEnabled: true,
        createdAt: "2026-08-19T19:30:00.000Z",
      },
      {
        accountId: "account_12121212-1212-1212-1212-121212121212",
        providerId: "provider_10101010-1010-1010-1010-101010101010",
        label: "ChatGPT Plus primary",
        authMechanism: "CHATGPT_INTERACTIVE",
        subscription: "Plus",
        availableSurfaces: ["CHAT"],
        health: "ACTIVE",
        isEnabled: true,
        createdAt: "2026-08-19T19:31:00.000Z",
      },
    ],
    models: [
      {
        modelId: "model_20202020-2020-2020-2020-202020202020",
        slug: "gpt-x",
        displayName: "GPT-X",
        family: "gpt",
        capabilities: {
          reasoning: true,
          toolUse: true,
          modalities: ["TEXT"],
          contextWindowTokens: 200000,
        },
        isEnabled: true,
        routes: [
          {
            modelRouteId: "model_route_30303030-3030-3030-3030-303030303030",
            providerId: "provider_10101010-1010-1010-1010-101010101010",
            accountId: "account_11111111-1111-1111-1111-111111111111",
            surface: "API",
            remoteModelId: "gpt-5-mini",
            availability: "AVAILABLE",
            contextWindowTokens: 200000,
            reasoningEfforts: ["MEDIUM"],
            supportedModalities: ["TEXT"],
            supportedToolIds: [],
            isEnabled: true,
          },
        ],
      },
    ],
    executionRoutes: [],
    agents: [
      {
        agentId: researchAgentId,
        slug: "researcher",
        displayName: "Research Lead",
        role: "Evidence-first research",
        isEnabled: true,
        skillAssignments: [],
        toolAssignments: [],
      },
      {
        agentId: reviewerAgentId,
        slug: "reviewer",
        displayName: "Reviewer",
        role: "Independent review",
        isEnabled: true,
        skillAssignments: [],
        toolAssignments: [],
      },
    ],
    skills: [],
    tools: [],
    projects: [
      {
        projectId,
        slug: "ai-world",
        name: "AI World",
        isArchived: false,
        createdAt: "2026-08-19T19:30:00.000Z",
        agentIds: [researchAgentId, reviewerAgentId],
      },
    ],
  });

  const operations = OperationsReadModelSchema.parse({
    schemaVersion: 1,
    generatedAt,
    actionGraph: { nodes: [], edges: [] },
    observatory: {
      runs: { total: 12, completed: 11, failed: 1 },
      tokens: { input: 14820, cachedInput: 3100, output: 2840 },
      context: { estimatedTokens: 9200, budgetTokens: 16000, pressure: 0.575 },
      monetaryCost: { status: "UNAVAILABLE" },
      routeSignals: [],
    },
  });

  const systemPreferences = ExecutionPreferenceLayerSchema.parse({
    schemaVersion: 1,
    scope: { kind: "SYSTEM" },
    overrides: {
      model: { kind: "AUTO" },
      account: { kind: "AUTO" },
      mode: "AUTO",
      context: "BALANCED",
      budget: "BALANCED",
    },
  });
  const preferences = ExecutionPreferenceReadModelSchema.parse({
    schemaVersion: 1,
    selection: {},
    local: systemPreferences,
    resolved: resolveExecutionPreferences([systemPreferences]),
  });

  const conversations = AgentConversationListSchema.parse({
    schemaVersion: 1,
    generatedAt,
    agent: { agentId: researchAgentId, displayName: "Research Lead" },
    conversations: [
      {
        conversationId,
        projectId,
        title: "Protocol review",
        createdAt: "2026-08-19T19:39:00.000Z",
        taskAssignmentAvailable: true,
      },
    ],
  });
  const conversation = ConversationReadModelSchema.parse({
    schemaVersion: 1,
    generatedAt,
    conversation: {
      conversationId,
      projectId,
      title: "Protocol review",
      createdAt: "2026-08-19T19:39:00.000Z",
    },
    agent: {
      agentId: researchAgentId,
      displayName: "Research Lead",
      role: "Evidence-first research",
      isEnabled: true,
    },
    messages: [
      {
        messageId: "message_10101010-1010-1010-1010-101010101010",
        author: "OWNER",
        content: "Проверь протокол и сохрани provenance для каждого вывода.",
        delivery: "DISPATCHED",
        createdAt: "2026-08-19T19:39:30.000Z",
        provenance: { kind: "DOMAIN" },
      },
      {
        messageId: "message_20202020-2020-2020-2020-202020202020",
        author: "AGENT",
        content: "Проверка идёт. Основные evidence уже привязаны к источникам.",
        delivery: "RECEIVED",
        createdAt: "2026-08-19T19:41:30.000Z",
        provenance: { kind: "RUNTIME", adapterKind: "OPENCLAW" },
      },
    ],
  });

  return { world, hub, operations, preferences, conversations, conversation };
}

function json(res, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Length": String(payload.byteLength),
    "Content-Type": "application/json; charset=utf-8",
    "X-Agent-World-Preview": "contract-fixture",
  });
  res.end(payload);
}

function empty(res, statusCode = 204) {
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "X-Agent-World-Preview": "contract-fixture",
  });
  res.end();
}

function previewApi(fixtures, req, res) {
  const url = new URL(req.url ?? "/", previewUrl);
  if (!url.pathname.startsWith("/api/")) return false;

  if (url.pathname === "/api/auth/session" && req.method === "GET") {
    json(res, 200, {
      schemaVersion: 1,
      authenticated: true,
      csrfToken,
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    return true;
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    json(res, 200, {
      schemaVersion: 1,
      authenticated: true,
      csrfToken,
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    return true;
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    empty(res);
    return true;
  }
  if (url.pathname === "/api/world" && req.method === "GET") {
    json(res, 200, fixtures.world);
    return true;
  }
  if (url.pathname === "/api/hub" && req.method === "GET") {
    json(res, 200, fixtures.hub);
    return true;
  }
  if (url.pathname === "/api/operations" && req.method === "GET") {
    json(res, 200, fixtures.operations);
    return true;
  }
  if (url.pathname === "/api/integrations" && req.method === "GET") {
    json(res, 200, { schemaVersion: 1, generatedAt, integrations: [] });
    return true;
  }
  if (url.pathname === "/api/schedules" && req.method === "GET") {
    json(res, 200, { schemaVersion: 1, schedules: [] });
    return true;
  }
  if (url.pathname === "/api/hub/native-chat-profiles" && req.method === "GET") {
    json(res, 200, { schemaVersion: 1, profiles: [] });
    return true;
  }
  if (url.pathname === "/api/hub/preferences" && req.method === "GET") {
    json(res, 200, fixtures.preferences);
    return true;
  }
  if (url.pathname === "/api/memory" && req.method === "GET") {
    const view = url.searchParams.get("view");
    if (view === "TIMELINE") {
      json(res, 200, { schemaVersion: 1, projectId, entries: [] });
    } else if (view === "NETWORK") {
      json(res, 200, { schemaVersion: 1, projectId, nodes: [], edges: [] });
    } else {
      json(res, 200, {
        schemaVersion: 1,
        projectId,
        proposals: [
          {
            schemaVersion: 1,
            id: "memory_proposal_56565656-5656-5656-5656-565656565656",
            projectId,
            sourceContextItemId: "context_item_57575757-5757-5757-5757-575757575757",
            content: "PostgreSQL remains canonical.",
            contentHash: "a".repeat(64),
            estimatedTokens: 5,
            importance: 0.9,
            status: "PENDING",
            createdAt: "2026-08-19T19:43:00.000Z",
          },
        ],
      });
    }
    return true;
  }
  if (
    /^\/api\/agents\/[^/]+\/conversations$/.test(url.pathname) &&
    req.method === "GET"
  ) {
    json(res, 200, fixtures.conversations);
    return true;
  }
  if (/^\/api\/conversations\/[^/]+$/.test(url.pathname) && req.method === "GET") {
    json(res, 200, fixtures.conversation);
    return true;
  }

  json(res, 409, {
    error: {
      code: "LOCAL_PREVIEW_READ_ONLY",
      message: "This loopback preview mocks read models only; no real mutation was executed.",
    },
  });
  return true;
}

function proxyRequest(req, res) {
  const upstream = http.request(
    {
      hostname: PREVIEW_HOST,
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${PREVIEW_HOST}:${BACKEND_PORT}` },
    },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );
  upstream.on("error", (error) => {
    if (!res.headersSent) {
      json(res, 502, { error: { code: "PREVIEW_BACKEND_UNAVAILABLE" } });
    } else {
      res.destroy(error);
    }
  });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head) {
  const upstream = net.connect(BACKEND_PORT, PREVIEW_HOST, () => {
    let requestHead = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      requestHead += `${req.rawHeaders[index]}: ${req.rawHeaders[index + 1]}\r\n`;
    }
    requestHead += "\r\n";
    upstream.write(requestHead);
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

async function waitForBackend(child) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js preview backend exited with code ${child.exitCode}`);
    }
    try {
      await fetch(backendUrl, { signal: AbortSignal.timeout(750) });
      return;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
  throw new Error("Timed out waiting for the Next.js preview backend");
}

function openBrowser() {
  if (process.argv.includes("--no-open")) return;
  const command =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", previewUrl]]
      : process.platform === "darwin"
        ? ["open", [previewUrl]]
        : ["xdg-open", [previewUrl]];
  try {
    const opener = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
    opener.unref();
  } catch {
    // The URL is printed below even when the desktop opener is unavailable.
  }
}

async function main() {
  if (process.versions.node.split(".")[0] !== "24") {
    throw new Error("Local preview requires the repository Node.js 24.x toolchain");
  }

  await ensureWorkspace();
  const fixtures = await buildFixtures();
  const backend = spawn(
    npm,
    [
      "run",
      "dev",
      "--workspace",
      "@agent-world/web",
      "--",
      "--hostname",
      PREVIEW_HOST,
      "--port",
      String(BACKEND_PORT),
    ],
    {
      cwd: root,
      env: { ...process.env, AGENT_WORLD_DATA_SOURCE: "contract-fixture" },
      stdio: "inherit",
    },
  );

  await waitForBackend(backend);
  const server = http.createServer((req, res) => {
    if (!previewApi(fixtures, req, res)) proxyRequest(req, res);
  });
  server.on("upgrade", proxyUpgrade);
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(PREVIEW_PORT, PREVIEW_HOST, resolvePromise);
  });

  const shutdown = () => {
    server.close();
    if (!backend.killed) backend.kill("SIGTERM");
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  backend.once("exit", (code) => {
    server.close();
    if (code && code !== 0) process.exitCode = code;
  });

  console.log("");
  console.log("[preview] AI World local visual preview is ready.");
  console.log(`[preview] Open ${previewUrl}`);
  console.log("[preview] Loopback only · contract fixtures · mutations are blocked · Ctrl+C stops it.");
  openBrowser();
}

main().catch((error) => {
  console.error(`[preview] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
