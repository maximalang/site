import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const POSTGRES_IMAGE =
  "pgvector/pgvector:0.8.6-pg18-bookworm@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a";
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
    AGENT_WORLD_SECRET_MASTER_KEY: randomBytes(32).toString("base64url"),
    AGENT_WORLD_SECRET_KEY_VERSION: "1",
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
  const anonymousOperations = await fetch(`${baseUrl}/api/operations`);
  if (anonymousOperations.status !== 401) {
    throw new Error(`Anonymous Operations request returned ${anonymousOperations.status}`);
  }
  const anonymousIntegrations = await fetch(`${baseUrl}/api/integrations`);
  if (anonymousIntegrations.status !== 401) {
    throw new Error(`Anonymous Integrations request returned ${anonymousIntegrations.status}`);
  }
  const anonymousMemory = await fetch(
    `${baseUrl}/api/memory?projectId=project_11111111-1111-1111-1111-111111111111&view=INBOX`,
  );
  if (anonymousMemory.status !== 401) {
    throw new Error(`Anonymous Memory request returned ${anonymousMemory.status}`);
  }
  const anonymousNativeChatProfiles = await fetch(`${baseUrl}/api/hub/native-chat-profiles`);
  if (anonymousNativeChatProfiles.status !== 401) {
    throw new Error(
      `Anonymous Native Chat profile request returned ${anonymousNativeChatProfiles.status}`,
    );
  }
  const missionId = "mission_12121212-1212-1212-1212-121212121212";
  const missionCommandBody = {
    schemaVersion: 1,
    id: "mission_14141414-1414-1414-1414-141414141414",
    projectId: "project_12121212-1212-1212-1212-121212121212",
    title: "Runtime owner Mission",
    goal: "Prove owner Mission creation through the production HTTP boundary.",
    status: "ACTIVE",
    executionPolicy: "REVIEW_EACH_TASK",
    successCriteria: [
      {
        id: "mission_criterion_14141414-1414-1414-1414-141414141414",
        statement: "Mission is durably persisted.",
        verification: "TEST",
        status: "PENDING",
        evidenceRefs: [],
      },
    ],
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
  };
  const anonymousMissionCreate = await fetch(`${baseUrl}/api/missions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify(missionCommandBody),
  });
  if (anonymousMissionCreate.status !== 401) {
    throw new Error(`Anonymous Mission create returned ${anonymousMissionCreate.status}`);
  }
  const anonymousMissionWorkflow = await fetch(`${baseUrl}/api/missions/workflow`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ missionId }),
  });
  if (anonymousMissionWorkflow.status !== 401) {
    throw new Error(`Anonymous Mission workflow returned ${anonymousMissionWorkflow.status}`);
  }
  const hubCommandBody = {
    schemaVersion: 1,
    commandId: "hub_command_55555555-5555-5555-5555-555555555555",
    kind: "PROVIDER_CREATE",
    providerId: "provider_66666666-6666-6666-6666-666666666666",
    slug: "local-models",
    displayName: "Local models",
    providerKind: "OLLAMA",
    category: "LOCAL_MODEL",
    baseUrl: "http://127.0.0.1:11434",
  };
  const anonymousHubCommand = await fetch(`${baseUrl}/api/hub/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify(hubCommandBody),
  });
  if (anonymousHubCommand.status !== 401) {
    throw new Error(`Anonymous Hub command returned ${anonymousHubCommand.status}`);
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
  database = new Pool({
    connectionString: databaseUrl,
    ssl: false,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  await database.query(
    `INSERT INTO agent_world.projects (id, slug, name)
     VALUES ($1, 'runtime-mission-project', 'Runtime Mission Project')`,
    ["project_12121212-1212-1212-1212-121212121212"],
  );
  const missionCreate = await fetch(`${baseUrl}/api/missions`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: baseUrl,
      "x-agent-world-csrf": loginBody.csrfToken,
    },
    body: JSON.stringify(missionCommandBody),
  });
  const missionCreateBody = await missionCreate.json();
  if (missionCreate.status !== 201 || missionCreateBody.mission?.id !== missionCommandBody.id) {
    throw new Error(`Owner Mission create returned ${missionCreate.status}`);
  }
  await database.query(
    `INSERT INTO agent_world.missions
       (id, project_id, title, goal, status, created_at, updated_at)
     VALUES ($1, $2, 'Runtime workflow', 'Prove durable production orchestration.',
             'ACTIVE', $3, $3)`,
    [missionId, "project_12121212-1212-1212-1212-121212121212", "2026-08-15T00:00:00.000Z"],
  );
  await database.query(
    `INSERT INTO agent_world.mission_success_criteria
       (id, mission_id, criterion_position, statement, verification, status, evidence_refs)
     VALUES ($1, $2, 0, 'Workflow checkpoint is durable.', 'TEST', 'PENDING', '[]'::jsonb)`,
    ["mission_criterion_13131313-1313-1313-1313-131313131313", missionId],
  );
  const missionWorkflow = await fetch(`${baseUrl}/api/missions/workflow`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: baseUrl,
      "x-agent-world-csrf": loginBody.csrfToken,
    },
    body: JSON.stringify({ missionId }),
  });
  const missionWorkflowBody = await missionWorkflow.json();
  if (
    missionWorkflow.status !== 200 ||
    missionWorkflowBody.missionId !== missionId ||
    missionWorkflowBody.pendingAction !== "DECOMPOSE_MISSION"
  ) {
    throw new Error("Production Mission workflow did not checkpoint its canonical planning state");
  }
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
  const operations = await fetch(`${baseUrl}/api/operations`, { headers: { cookie } });
  const operationsBody = await operations.json();
  if (
    operations.status !== 200 ||
    !Array.isArray(operationsBody.actionGraph?.nodes) ||
    operationsBody.observatory?.monetaryCost?.status !== "UNAVAILABLE"
  ) {
    throw new Error("Authorized Operations did not return a truthful bounded projection");
  }
  const integrationId = "integration_14141414-1414-4414-8414-141414141414";
  const integrationHeaders = {
    cookie,
    "content-type": "application/json",
    origin: baseUrl,
    "x-agent-world-csrf": loginBody.csrfToken,
  };
  const createIntegration = await fetch(`${baseUrl}/api/integrations`, {
    method: "POST",
    headers: integrationHeaders,
    body: JSON.stringify({
      id: integrationId,
      commandId: "integration:create:runtime",
      kind: "MCP",
      label: "Runtime MCP",
      endpoint: { transport: "HTTPS", url: "https://world.example/api/mcp" },
      createdAt: "2026-08-15T00:00:00.000Z",
    }),
  });
  const writeIntegrationCredential = await fetch(`${baseUrl}/api/integrations`, {
    method: "POST",
    headers: integrationHeaders,
    body: JSON.stringify({
      operation: "CREDENTIAL",
      integrationId,
      commandId: "integration:credential:runtime",
      plaintext: "runtime-integration-secret",
    }),
  });
  const disableIntegration = await fetch(`${baseUrl}/api/integrations`, {
    method: "POST",
    headers: integrationHeaders,
    body: JSON.stringify({
      operation: "DISABLE",
      integrationId,
      commandId: "integration:disable:runtime",
    }),
  });
  const enableIntegration = await fetch(`${baseUrl}/api/integrations`, {
    method: "POST",
    headers: integrationHeaders,
    body: JSON.stringify({
      operation: "ENABLE",
      integrationId,
      commandId: "integration:enable:runtime",
    }),
  });
  const testIntegration = await fetch(`${baseUrl}/api/integrations`, {
    method: "POST",
    headers: integrationHeaders,
    body: JSON.stringify({
      operation: "TEST",
      integrationId,
      commandId: "integration:test:runtime",
    }),
  });
  const testIntegrationBody = await testIntegration.json();
  const replayIntegrationTest = await fetch(`${baseUrl}/api/integrations`, {
    method: "POST",
    headers: integrationHeaders,
    body: JSON.stringify({
      operation: "TEST",
      integrationId,
      commandId: "integration:test:runtime",
    }),
  });
  const replayIntegrationTestBody = await replayIntegrationTest.json();
  const integrations = await fetch(`${baseUrl}/api/integrations`, { headers: { cookie } });
  const integrationBody = await integrations.json();
  if (
    createIntegration.status !== 201 ||
    writeIntegrationCredential.status !== 201 ||
    disableIntegration.status !== 201 ||
    enableIntegration.status !== 201 ||
    testIntegration.status !== 201 ||
    testIntegrationBody.result?.health !== "ERROR" ||
    testIntegrationBody.result?.code !== "HOST_NOT_ALLOWLISTED" ||
    replayIntegrationTest.status !== 201 ||
    replayIntegrationTestBody.result?.outcome !== "REPLAY" ||
    integrations.status !== 200 ||
    integrationBody.integrations?.[0]?.hasCredential !== true ||
    integrationBody.integrations?.[0]?.isEnabled !== true ||
    integrationBody.integrations?.[0]?.health !== "ERROR" ||
    JSON.stringify(integrationBody).includes("runtime-integration-secret")
  ) {
    throw new Error(
      `Integration HTTP lifecycle failed: create=${createIntegration.status} credential=${writeIntegrationCredential.status} list=${integrations.status} count=${integrationBody.integrations?.length ?? "invalid"} configured=${integrationBody.integrations?.[0]?.hasCredential ?? "invalid"}`,
    );
  }
  await database.query(
    "UPDATE agent_world.integration_endpoints SET health = 'READY' WHERE id = $1",
    [integrationId],
  );
  const actionCommand = {
    operation: "ACTION",
    integrationId,
    commandId: "integration:action:runtime",
    action: "MCP_LIST_TOOLS",
  };
  const integrationAction = await fetch(`${baseUrl}/api/integrations`, {
    method: "POST",
    headers: integrationHeaders,
    body: JSON.stringify(actionCommand),
  });
  const integrationActionBody = await integrationAction.json();
  const replayIntegrationAction = await fetch(`${baseUrl}/api/integrations`, {
    method: "POST",
    headers: integrationHeaders,
    body: JSON.stringify(actionCommand),
  });
  const replayIntegrationActionBody = await replayIntegrationAction.json();
  if (
    integrationAction.status !== 201 ||
    integrationActionBody.result?.status !== "FAILED" ||
    integrationActionBody.result?.items?.[0]?.label !== "HOST_NOT_ALLOWLISTED" ||
    replayIntegrationAction.status !== 201 ||
    replayIntegrationActionBody.result?.outcome !== "REPLAY"
  ) {
    throw new Error("Integration action was not durably recorded and replayed");
  }
  const projectId = "project_11111111-1111-1111-1111-111111111111";
  const memoryInbox = await fetch(
    `${baseUrl}/api/memory?projectId=${encodeURIComponent(projectId)}&view=INBOX`,
    { headers: { cookie } },
  );
  const memoryInboxBody = await memoryInbox.json();
  if (
    memoryInbox.status !== 200 ||
    memoryInboxBody.projectId !== projectId ||
    !Array.isArray(memoryInboxBody.proposals)
  ) {
    throw new Error("Authorized Memory Inbox did not return its canonical projection");
  }
  const nativeChatProfiles = await fetch(`${baseUrl}/api/hub/native-chat-profiles`, {
    headers: { cookie },
  });
  const nativeChatProfilesBody = await nativeChatProfiles.json();
  if (
    nativeChatProfiles.status !== 200 ||
    nativeChatProfilesBody.schemaVersion !== 1 ||
    nativeChatProfilesBody.profiles?.length !== 0
  ) {
    throw new Error("Authorized Native Chat profile projection was not empty and bounded");
  }
  const anonymousPreferences = await fetch(`${baseUrl}/api/hub/preferences`);
  if (anonymousPreferences.status !== 401) {
    throw new Error(`Anonymous execution preferences returned ${anonymousPreferences.status}`);
  }
  const preferences = await fetch(`${baseUrl}/api/hub/preferences`, { headers: { cookie } });
  const preferencesBody = await preferences.json();
  if (
    preferences.status !== 200 ||
    preferencesBody.local?.scope?.kind !== "SYSTEM" ||
    preferencesBody.resolved?.budget?.value !== "BALANCED"
  ) {
    throw new Error("Owner execution preferences did not expose System provenance");
  }
  const hubCommandHeaders = {
    cookie,
    "content-type": "application/json",
    origin: baseUrl,
    "x-agent-world-csrf": loginBody.csrfToken,
  };
  const writePreferences = await fetch(`${baseUrl}/api/hub/preferences`, {
    method: "PUT",
    headers: hubCommandHeaders,
    body: JSON.stringify({
      schemaVersion: 1,
      scope: { kind: "SYSTEM" },
      overrides: {
        model: { kind: "AUTO" },
        account: { kind: "AUTO" },
        mode: "AUTO",
        context: "LEAN",
        budget: "BALANCED",
      },
    }),
  });
  if (writePreferences.status !== 204) {
    throw new Error(`Owner execution preference update returned ${writePreferences.status}`);
  }
  const updatedPreferences = await fetch(`${baseUrl}/api/hub/preferences`, {
    headers: { cookie },
  });
  if (
    updatedPreferences.status !== 200 ||
    (await updatedPreferences.json()).resolved?.context?.value !== "LEAN"
  ) {
    throw new Error("Execution preference update was not visible through the read model");
  }
  const createProvider = await fetch(`${baseUrl}/api/hub/commands`, {
    method: "POST",
    headers: hubCommandHeaders,
    body: JSON.stringify(hubCommandBody),
  });
  const createProviderBody = await createProvider.json();
  if (createProvider.status !== 201 || createProviderBody.outcome !== "CREATED") {
    throw new Error("Authorized Hub command did not create a canonical Provider");
  }
  const replayProvider = await fetch(`${baseUrl}/api/hub/commands`, {
    method: "POST",
    headers: hubCommandHeaders,
    body: JSON.stringify(hubCommandBody),
  });
  if (replayProvider.status !== 200 || (await replayProvider.json()).outcome !== "REPLAY") {
    throw new Error("Authorized Hub command did not replay the committed Provider command");
  }
  const consumerProviderId = "provider_16161616-1616-4616-8616-161616161616";
  const chatAccountId = "account_16161616-1616-4616-8616-161616161616";
  for (const command of [
    {
      schemaVersion: 1,
      commandId: "hub_command_16161616-1616-4616-8616-161616161616",
      kind: "PROVIDER_CREATE",
      providerId: consumerProviderId,
      slug: "chatgpt-consumer-runtime",
      displayName: "ChatGPT consumer accounts",
      providerKind: "OPENAI",
      category: "CONSUMER_ACCOUNT",
    },
    {
      schemaVersion: 1,
      commandId: "hub_command_17171717-1717-4717-8717-171717171717",
      kind: "ACCOUNT_CREATE",
      accountId: chatAccountId,
      providerId: consumerProviderId,
      label: "Plus primary",
      authMechanism: "CHATGPT_INTERACTIVE",
      subscription: "Plus",
      availableSurfaces: ["CHAT", "CODEX"],
    },
  ]) {
    const response = await fetch(`${baseUrl}/api/hub/commands`, {
      method: "POST",
      headers: hubCommandHeaders,
      body: JSON.stringify(command),
    });
    if (response.status !== 201)
      throw new Error(`ChatGPT Account setup returned ${response.status}`);
  }
  const provisionedAgentId = "agent_15151515-1515-4515-8515-151515151515";
  const provisionAgent = await fetch(`${baseUrl}/api/hub/commands`, {
    method: "POST",
    headers: hubCommandHeaders,
    body: JSON.stringify({
      schemaVersion: 1,
      commandId: "hub_command_15151515-1515-4515-8515-151515151515",
      kind: "AGENT_CREATE",
      agentId: provisionedAgentId,
      slug: "runtime-provisioned-agent",
      displayName: "Runtime Provisioned Agent",
      role: "Prove atomic provisioning",
      instructions: "Use canonical runtime evidence.",
      provisioning: {
        templateId: "agent_template_15151515-1515-4515-8515-151515151515",
        templateVersion: 1,
        projectId: "project_12121212-1212-1212-1212-121212121212",
        skillIds: [],
        toolIds: [],
        preferences: { mode: "AUTO", context: "RICH", budget: "QUALITY" },
      },
    }),
  });
  if (provisionAgent.status !== 201 || (await provisionAgent.json()).outcome !== "CREATED") {
    throw new Error(`Owner Agent provisioning returned ${provisionAgent.status}`);
  }
  const conflictingProvider = await fetch(`${baseUrl}/api/hub/commands`, {
    method: "POST",
    headers: hubCommandHeaders,
    body: JSON.stringify({ ...hubCommandBody, displayName: "Conflicting Provider" }),
  });
  if (
    conflictingProvider.status !== 409 ||
    (await conflictingProvider.json()).error?.code !== "IDEMPOTENCY_CONFLICT"
  ) {
    throw new Error("Hub command endpoint accepted conflicting immutable input");
  }
  const updatedHub = await fetch(`${baseUrl}/api/hub`, { headers: { cookie } });
  const updatedHubBody = await updatedHub.json();
  if (
    updatedHub.status !== 200 ||
    updatedHubBody.providers?.filter(({ providerId }) => providerId === hubCommandBody.providerId)
      .length !== 1 ||
    updatedHubBody.agents?.filter(({ agentId }) => agentId === provisionedAgentId).length !== 1 ||
    updatedHubBody.accounts?.filter(
      ({ accountId }) => accountId === chatAccountId && !String(accountId).startsWith("agent_"),
    ).length !== 1
  ) {
    throw new Error("Hub read model did not expose exactly one command-created Provider");
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
  const approvalBody = JSON.stringify({
    schemaVersion: 1,
    taskId: "task_44444444-4444-4444-4444-444444444444",
    decisionId: "55555555-5555-4555-8555-555555555555",
    decision: "APPROVE",
  });
  const anonymousApproval = await fetch(`${baseUrl}/api/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: approvalBody,
  });
  if (anonymousApproval.status !== 401) {
    throw new Error(`Anonymous approval decision returned ${anonymousApproval.status}`);
  }
  const missingApproval = await fetch(`${baseUrl}/api/approvals`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: baseUrl,
      "x-agent-world-csrf": loginBody.csrfToken,
    },
    body: approvalBody,
  });
  const missingApprovalBody = await missingApproval.json();
  if (missingApproval.status !== 404 || missingApprovalBody.error?.code !== "APPROVAL_NOT_FOUND") {
    throw new Error(
      `Approval identity guard returned ${missingApproval.status}/${String(missingApprovalBody.error?.code).slice(0, 64)}`,
    );
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

  const evidence = await database.query(
    `SELECT
       (SELECT count(*)::integer FROM agent_world.schema_migrations) AS migrations,
       (SELECT count(*)::integer FROM agent_world.owner_sessions WHERE revoked_at IS NOT NULL) AS revoked_sessions,
       (SELECT count(*)::integer FROM agent_world_langgraph.checkpoints
         WHERE thread_id = $1) AS mission_checkpoints`,
    [missionId],
  );
  if (
    evidence.rows[0]?.migrations !== 37 ||
    evidence.rows[0]?.revoked_sessions !== 1 ||
    evidence.rows[0]?.mission_checkpoints < 1
  ) {
    throw new Error("Standalone runtime did not preserve migration or revocation evidence");
  }

  process.stdout.write(
    `${JSON.stringify({ status: "PASS", postgresImage: POSTGRES_IMAGE, migrations: 37, authLifecycle: true, worldAuth: true, hubAuth: true, operationsAuth: true, integrationsAuth: true, integrationLifecycle: true, integrationProbeReplay: true, integrationActionReplay: true, chatGptAccountCreate: true, missionCreateAuth: true, agentProvisioningAuth: true, memoryAuth: true, nativeChatProfileAuth: true, hubCommandAuth: true, hubCommandReplay: true, executionPreferenceAuth: true, executionPreferenceWrite: true, conversationAuth: true, agentConversationAuth: true, taskAuth: true, approvalAuth: true, missionWorkflowCheckpoint: true, restartRevocation: true, optionalAdapterIsolation: true })}\n`,
  );
} finally {
  if (runtimeServer) await stopRuntimeServer(runtimeServer);
  await database?.end().catch(() => undefined);
  await docker(["rm", "--force", "--volumes", containerName], { allowFailure: true });
}
