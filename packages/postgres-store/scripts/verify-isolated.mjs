import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  AgentIdSchema,
  AgentSchema,
  ConversationIdSchema,
  MessageIdSchema,
  SendMessageIntentSchema,
} from "@agent-world/domain";
import { Pool } from "pg";
import {
  applyMigrations,
  discoverMigrations,
  PostgresAgentConversationReader,
  PostgresConversationReader,
  PostgresConversationStore,
  PostgresOwnerSessionStore,
  PostgresRuntimeMessageStore,
  PostgresWorldProjectionStore,
} from "../dist/index.js";

const IMAGE =
  "postgres:18.3-bookworm@sha256:4b2a518e377fe4cbb67168b8043724634f144cbad35a306c6bab44fced4ec2c7";
const ACK = "AGENT_WORLD_DB_TEST_ACK";

if (process.env[ACK] !== "isolated") {
  throw new Error(`${ACK}=isolated is required; the verifier never accepts a user database`);
}

function runDocker(args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure) {
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`docker ${args[0]} failed with exit code ${code}`));
      }
    });
  });
}

async function expectRejected(promise, message) {
  let rejected = false;
  try {
    await promise;
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(message);
}

const suffix = randomBytes(8).toString("hex");
const containerName = `agent-world-db-test-${suffix}`;
if (!/^agent-world-db-test-[a-f0-9]{16}$/.test(containerName)) {
  throw new Error("Refusing to manage an unexpected Docker container name");
}
const password = randomBytes(24).toString("base64url");
let pool;

try {
  await runDocker([
    "run",
    "--detach",
    "--name",
    containerName,
    "--tmpfs",
    "/var/lib/postgresql:rw,noexec,nosuid,size=256m",
    "--publish",
    "127.0.0.1::5432",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    "--env",
    "POSTGRES_DB=agent_world_test",
    "--health-cmd",
    "pg_isready -U postgres -d agent_world_test",
    "--health-interval",
    "1s",
    "--health-timeout",
    "3s",
    "--health-retries",
    "30",
    IMAGE,
  ]);

  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const inspection = await runDocker([
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      containerName,
    ]);
    if (inspection.stdout === "healthy") {
      healthy = true;
      break;
    }
    if (inspection.stdout === "unhealthy") {
      throw new Error("Isolated PostgreSQL container became unhealthy");
    }
    await delay(500);
  }
  if (!healthy) {
    throw new Error("Timed out waiting for isolated PostgreSQL readiness");
  }

  const portResult = await runDocker(["port", containerName, "5432/tcp"]);
  const portMatch = /^127\.0\.0\.1:(\d+)$/.exec(portResult.stdout);
  if (!portMatch) {
    throw new Error("Isolated PostgreSQL was not published on loopback");
  }
  const port = Number.parseInt(portMatch[1], 10);
  pool = new Pool({
    host: "127.0.0.1",
    port,
    database: "agent_world_test",
    user: "postgres",
    password,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
  });

  const migrations = await discoverMigrations();
  const legacy = {
    account: "account_09090909-0909-0909-0909-090909090909",
    agent: "agent_0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a",
    conversation: "conversation_0b0b0b0b-0b0b-0b0b-0b0b-0b0b0b0b0b0b",
    project: "project_0c0c0c0c-0c0c-0c0c-0c0c-0c0c0c0c0c0c",
  };
  const client = await pool.connect();
  try {
    await applyMigrations(client, migrations.slice(0, 5));
    await client.query("INSERT INTO agent_world.accounts (id, label) VALUES ($1, $2)", [
      legacy.account,
      "Legacy OpenClaw account",
    ]);
    await client.query("INSERT INTO agent_world.projects (id, name) VALUES ($1, $2)", [
      legacy.project,
      "Legacy project",
    ]);
    await client.query(
      `INSERT INTO agent_world.agents
         (id, slug, display_name, role, instructions)
       VALUES ($1, $2, $3, $4, $5)`,
      [legacy.agent, "legacy-agent", "Legacy Agent", "Migration", "Preserve canonical state."],
    );
    await client.query(
      `INSERT INTO agent_world.conversations
         (id, agent_id, project_id, title, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        legacy.conversation,
        legacy.agent,
        legacy.project,
        "Legacy conversation",
        "2026-08-13T07:00:00.000Z",
      ],
    );
    await applyMigrations(client, migrations);
    await applyMigrations(client, migrations);
  } finally {
    client.release();
  }

  const ledger = await pool.query(
    "SELECT version, name, checksum FROM agent_world.schema_migrations ORDER BY version",
  );
  if (
    ledger.rowCount !== migrations.length ||
    ledger.rows[0]?.version !== 1 ||
    ledger.rows.at(-1)?.version !== 6
  ) {
    throw new Error("Migration ledger does not match the discovered migration set");
  }
  const legacyUpgrade = await pool.query(
    `SELECT a.provider_id, a.auth_mechanism, a.health, p.slug,
            EXISTS (
              SELECT 1
                FROM agent_world.project_agents pa
               WHERE pa.project_id = $2 AND pa.agent_id = $3
            ) AS membership_backfilled,
            EXISTS (
              SELECT 1
                FROM agent_world.account_surfaces s
               WHERE s.account_id = $1 AND s.surface = 'CHAT'
            ) AS surface_backfilled
       FROM agent_world.accounts a
       JOIN agent_world.projects p ON p.id = $2
      WHERE a.id = $1`,
    [legacy.account, legacy.project, legacy.agent],
  );
  if (
    legacyUpgrade.rows[0]?.provider_id !== "provider_00000000-0000-0000-0000-000000000001" ||
    legacyUpgrade.rows[0]?.auth_mechanism !== "TOKEN" ||
    legacyUpgrade.rows[0]?.health !== "UNCONFIGURED" ||
    legacyUpgrade.rows[0]?.slug !== "project-0c0c0c0c-0c0c-0c0c-0c0c-0c0c0c0c0c0c" ||
    legacyUpgrade.rows[0]?.membership_backfilled !== true ||
    legacyUpgrade.rows[0]?.surface_backfilled !== true
  ) {
    throw new Error("Canonical Hub migration did not preserve and backfill legacy state");
  }
  const tables = await pool.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'agent_world'
      ORDER BY table_name`,
  );
  const names = tables.rows.map(({ table_name: tableName }) => tableName);
  for (const required of [
    "agents",
    "agent_skills",
    "agent_tools",
    "account_surfaces",
    "canonical_models",
    "canonical_model_modalities",
    "conversations",
    "conversation_sessions",
    "conversation_messages",
    "model_routes",
    "model_route_modalities",
    "model_route_reasoning_efforts",
    "model_route_tools",
    "owner_auth_throttle",
    "owner_sessions",
    "project_agents",
    "providers",
    "runtime_bindings",
    "schema_migrations",
    "skills",
    "tasks",
    "tools",
    "world_event_stream",
    "world_agent_status",
    "world_events",
  ]) {
    if (!names.includes(required)) {
      throw new Error(`Canonical table is missing after migration: ${required}`);
    }
  }

  const ownerSessions = new PostgresOwnerSessionStore(pool);
  const sessionTokenHash = "a".repeat(64);
  await ownerSessions.createSession({
    tokenHash: sessionTokenHash,
    createdAt: "2026-08-13T08:00:00.000Z",
    expiresAt: "2026-08-13T20:00:00.000Z",
  });
  const activeOwnerSession = await ownerSessions.resolveSession({
    tokenHash: sessionTokenHash,
    now: "2026-08-13T10:00:00.000Z",
  });
  if (activeOwnerSession?.expiresAt !== "2026-08-13T20:00:00.000Z") {
    throw new Error("PostgreSQL owner session store did not resolve an active session");
  }
  await ownerSessions.revokeSession(sessionTokenHash, "2026-08-13T10:01:00.000Z");
  if (
    (await ownerSessions.resolveSession({
      tokenHash: sessionTokenHash,
      now: "2026-08-13T10:02:00.000Z",
    })) !== undefined
  ) {
    throw new Error("PostgreSQL owner session store resolved a revoked session");
  }
  await ownerSessions.createSession({
    tokenHash: "b".repeat(64),
    createdAt: "2026-08-13T08:00:00.000Z",
    expiresAt: "2026-08-13T09:00:00.000Z",
  });
  if ((await ownerSessions.pruneExpiredSessions("2026-08-13T10:03:00.000Z")) !== 1) {
    throw new Error("PostgreSQL owner session store did not prune exactly the expired session");
  }
  await ownerSessions.resetLoginThrottle("2026-08-13T11:00:00.000Z");
  const concurrentLoginClaims = await Promise.all(
    Array.from({ length: 6 }, () => ownerSessions.claimLoginAttempt("2026-08-13T11:00:01.000Z")),
  );
  if (
    concurrentLoginClaims.filter((result) => result === "ALLOWED").length !== 5 ||
    concurrentLoginClaims.filter((result) => result === "BLOCKED").length !== 1
  ) {
    throw new Error("PostgreSQL owner login throttle did not atomically enforce its attempt limit");
  }
  await ownerSessions.resetLoginThrottle("2026-08-13T11:01:00.000Z");
  if ((await ownerSessions.claimLoginAttempt("2026-08-13T11:01:01.000Z")) !== "ALLOWED") {
    throw new Error("PostgreSQL owner login throttle did not reset after successful authorization");
  }

  const ids = {
    account: "account_11111111-1111-1111-1111-111111111111",
    agent: AgentIdSchema.parse("agent_22222222-2222-2222-2222-222222222222"),
    binding: "binding_33333333-3333-3333-3333-333333333333",
    conversation: ConversationIdSchema.parse("conversation_44444444-4444-4444-4444-444444444444"),
    project: "project_55555555-5555-5555-5555-555555555555",
    route: "route_66666666-6666-6666-6666-666666666666",
    session: "session_77777777-7777-7777-7777-777777777777",
  };
  const openClawProviderId = "provider_00000000-0000-0000-0000-000000000001";
  const hub = {
    provider: "provider_88888888-8888-8888-8888-888888888888",
    primaryAccount: "account_89898989-8989-8989-8989-898989898989",
    secondaryAccount: "account_90909090-9090-9090-9090-909090909090",
    model: "model_91919191-9191-9191-9191-919191919191",
    primaryModelRoute: "model_route_92929292-9292-9292-9292-929292929292",
    secondaryModelRoute: "model_route_93939393-9393-9393-9393-939393939393",
    tool: "tool_94949494-9494-9494-9494-949494949494",
    skill: "skill_95959595-9595-9595-9595-959595959595",
    secondaryAgent: "agent_96969696-9696-9696-9696-969696969696",
    primaryExecutionRoute: "route_97979797-9797-9797-9797-979797979797",
    secondaryExecutionRoute: "route_98989898-9898-9898-9898-989898989898",
  };
  await pool.query(
    `INSERT INTO agent_world.accounts
       (id, provider_id, label, auth_mechanism, health)
     VALUES ($1, $2, $3, 'TOKEN', 'ACTIVE')`,
    [ids.account, openClawProviderId, "OpenClaw account"],
  );
  await pool.query(
    "INSERT INTO agent_world.account_surfaces (account_id, surface) VALUES ($1, 'CHAT')",
    [ids.account],
  );
  await pool.query("INSERT INTO agent_world.projects (id, slug, name) VALUES ($1, $2, $3)", [
    ids.project,
    "protocol-project",
    "Protocol project",
  ]);
  await pool.query(
    `INSERT INTO agent_world.agents
       (id, slug, display_name, role, instructions)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      ids.agent,
      "researcher",
      "Researcher",
      "Protocol verification",
      "Verify protocol contracts with evidence.",
    ],
  );
  await pool.query(
    `INSERT INTO agent_world.providers
       (id, slug, display_name, kind, category, base_url)
     VALUES ($1, 'openai', 'OpenAI', 'OPENAI', 'LLM_API', 'https://api.openai.com/v1')`,
    [hub.provider],
  );
  await pool.query(
    `INSERT INTO agent_world.accounts
       (id, provider_id, label, auth_mechanism, health, credential_ref)
     VALUES
       ($1, $3, 'Primary OpenAI API', 'API_KEY', 'ACTIVE', 'secret-store:accounts/openai-primary'),
       ($2, $3, 'Fallback OpenAI API', 'API_KEY', 'DEGRADED', 'vault:accounts/openai-fallback')`,
    [hub.primaryAccount, hub.secondaryAccount, hub.provider],
  );
  await pool.query(
    `INSERT INTO agent_world.account_surfaces (account_id, surface)
     VALUES ($1, 'API'), ($2, 'API')`,
    [hub.primaryAccount, hub.secondaryAccount],
  );
  await pool.query(
    `INSERT INTO agent_world.canonical_models
       (id, slug, display_name, family, reasoning, tool_use,
        context_window_tokens, max_output_tokens)
     VALUES ($1, 'gpt-x', 'GPT-X', 'gpt', true, true, 200000, 32000)`,
    [hub.model],
  );
  await pool.query(
    `INSERT INTO agent_world.canonical_model_modalities (canonical_model_id, modality)
     VALUES ($1, 'TEXT'), ($1, 'IMAGE_INPUT')`,
    [hub.model],
  );
  await pool.query(
    `INSERT INTO agent_world.tools
       (id, slug, display_name, kind, description, configuration_ref)
     VALUES ($1, 'browser-search', 'Browser search', 'BROWSER',
             'Search owner-approved primary sources.', 'env:BROWSER_SEARCH_CONFIG')`,
    [hub.tool],
  );
  await pool.query(
    `INSERT INTO agent_world.skills
       (id, slug, display_name, version, description, source_kind, source_ref, integrity_sha256)
     VALUES ($1, 'source-research', 'Source research', '1.2.0',
             'Collect and verify primary sources.', 'LOCAL_PATH',
             'skills/source-research/SKILL.md', $2)`,
    [hub.skill, "c".repeat(64)],
  );
  await pool.query(
    `INSERT INTO agent_world.model_routes
       (id, canonical_model_id, provider_id, account_id, surface, remote_model_id,
        availability, price_currency, input_price_per_million,
        output_price_per_million, context_window_tokens)
     VALUES
       ($1, $3, $4, $5, 'API', 'gpt-x-2026-08-01', 'AVAILABLE', 'USD', 2.5, 10, 200000),
       ($2, $3, $4, $6, 'API', 'gpt-x-2026-08-01', 'DEGRADED', 'USD', 2.7, 10.5, 200000)`,
    [
      hub.primaryModelRoute,
      hub.secondaryModelRoute,
      hub.model,
      hub.provider,
      hub.primaryAccount,
      hub.secondaryAccount,
    ],
  );
  await pool.query(
    `INSERT INTO agent_world.model_route_reasoning_efforts (model_route_id, effort)
     VALUES ($1, 'LOW'), ($1, 'HIGH'), ($2, 'LOW')`,
    [hub.primaryModelRoute, hub.secondaryModelRoute],
  );
  await pool.query(
    `INSERT INTO agent_world.model_route_modalities (model_route_id, modality)
     VALUES ($1, 'TEXT'), ($1, 'IMAGE_INPUT'), ($2, 'TEXT')`,
    [hub.primaryModelRoute, hub.secondaryModelRoute],
  );
  await pool.query(
    `INSERT INTO agent_world.model_route_tools (model_route_id, tool_id)
     VALUES ($1, $2)`,
    [hub.primaryModelRoute, hub.tool],
  );
  await pool.query(
    `INSERT INTO agent_world.agent_skills (agent_id, skill_id, priority)
     VALUES ($1, $2, 10)`,
    [ids.agent, hub.skill],
  );
  await pool.query(
    `INSERT INTO agent_world.agent_tools (agent_id, tool_id)
     VALUES ($1, $2)`,
    [ids.agent, hub.tool],
  );
  await pool.query(
    `INSERT INTO agent_world.agents
       (id, slug, display_name, role, instructions)
     VALUES ($1, 'hub-auditor', 'Hub Auditor', 'Canonical Hub verification',
             'Verify canonical identities and route boundaries.')`,
    [hub.secondaryAgent],
  );
  await pool.query(
    `INSERT INTO agent_world.execution_routes
       (id, label, mode, adapter_kind, account_id, model_route_id)
     VALUES
       ($1, 'Primary GPT-X', 'API', 'API_MODEL', $3, $4),
       ($2, 'Secondary GPT-X', 'API', 'API_MODEL', $3, $4)`,
    [
      hub.primaryExecutionRoute,
      hub.secondaryExecutionRoute,
      hub.primaryAccount,
      hub.primaryModelRoute,
    ],
  );
  await pool.query(
    `UPDATE agent_world.agents
        SET preferred_route_id = CASE id WHEN $1 THEN $2 WHEN $3 THEN $4 END
      WHERE id IN ($1, $3)`,
    [ids.agent, hub.primaryExecutionRoute, hub.secondaryAgent, hub.secondaryExecutionRoute],
  );
  await expectRejected(
    pool.query(
      `INSERT INTO agent_world.model_routes
         (id, canonical_model_id, provider_id, account_id, surface, remote_model_id,
          availability, context_window_tokens)
       VALUES ('model_route_a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', $1, $2, $3,
               'API', 'gpt-x-2026-08-01', 'AVAILABLE', 200000)`,
      [hub.model, hub.provider, hub.primaryAccount],
    ),
    "Canonical Hub accepted a duplicate provider/account ModelRoute identity",
  );
  await expectRejected(
    pool.query(
      `INSERT INTO agent_world.model_routes
         (id, canonical_model_id, provider_id, account_id, surface, remote_model_id,
          availability, context_window_tokens)
       VALUES ('model_route_a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2', $1, $2, $3,
               'API', 'cross-provider', 'AVAILABLE', 200000)`,
      [hub.model, openClawProviderId, hub.primaryAccount],
    ),
    "Canonical Hub accepted an Account under the wrong Provider",
  );
  await expectRejected(
    pool.query(
      `INSERT INTO agent_world.model_routes
         (id, canonical_model_id, provider_id, account_id, surface, remote_model_id,
          availability, context_window_tokens)
       VALUES ('model_route_a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3', $1, $2, $3,
               'CHAT', 'unsupported-surface', 'AVAILABLE', 200000)`,
      [hub.model, hub.provider, hub.primaryAccount],
    ),
    "Canonical Hub accepted a ModelRoute on an unavailable Account surface",
  );
  const hubEvidence = await pool.query(
    `SELECT
       (SELECT count(*)::integer FROM agent_world.canonical_models WHERE id = $1) AS models,
       (SELECT count(*)::integer FROM agent_world.model_routes WHERE canonical_model_id = $1) AS routes,
       (SELECT count(*)::integer
          FROM agent_world.agents a
          JOIN agent_world.execution_routes r ON r.id = a.preferred_route_id
         WHERE r.account_id = $2) AS agents_sharing_account,
       (SELECT count(*)::integer
          FROM information_schema.columns
         WHERE table_schema = 'agent_world'
           AND table_name IN ('providers', 'accounts', 'model_routes', 'tools')
           AND column_name IN ('api_key', 'token', 'password', 'secret')) AS raw_secret_columns`,
    [hub.model, hub.primaryAccount],
  );
  if (
    hubEvidence.rows[0]?.models !== 1 ||
    hubEvidence.rows[0]?.routes !== 2 ||
    hubEvidence.rows[0]?.agents_sharing_account !== 2 ||
    hubEvidence.rows[0]?.raw_secret_columns !== 0
  ) {
    throw new Error("Canonical Hub identities, route reuse, or secret boundaries drifted");
  }
  await pool.query(
    `INSERT INTO agent_world.execution_routes
       (id, label, mode, adapter_kind, account_id)
     VALUES ($1, $2, 'CHAT', 'OPENCLAW', $3)`,
    [ids.route, "OpenClaw chat", ids.account],
  );
  await pool.query(
    `INSERT INTO agent_world.runtime_bindings
       (id, agent_id, route_id, adapter_kind, external_agent_id)
     VALUES ($1, $2, $3, 'OPENCLAW', $4)`,
    [ids.binding, ids.agent, ids.route, "researcher"],
  );
  const worldEventIds = [
    "event_13131313-1313-1313-1313-131313131313",
    "event_14141414-1414-1414-1414-141414141414",
    "event_15151515-1515-1515-1515-151515151515",
    "event_16161616-1616-1616-1616-161616161616",
  ];
  const worldStore = new PostgresWorldProjectionStore(pool, {
    eventId: () => {
      const eventId = worldEventIds.shift();
      if (!eventId) throw new Error("Isolated World event identities were exhausted");
      return eventId;
    },
  });
  const worldAgent = AgentSchema.parse({
    schemaVersion: 1,
    id: ids.agent,
    slug: "researcher",
    displayName: "Researcher",
    role: "Protocol verification",
    instructions: "Verify protocol contracts with evidence.",
    isEnabled: true,
  });
  await worldStore.applyOpenClawSnapshot({
    observedAt: "2026-08-13T09:15:00.000Z",
    observationId: "isolated-runtime:epoch-1:sequence-1",
    statuses: [{ agentId: ids.agent, bindingId: ids.binding, status: "RUNNING" }],
  });
  const restartRead = await new PostgresWorldProjectionStore(pool).readWorld([worldAgent]);
  if (restartRead.cursor.lastSequence !== 1 || restartRead.agents[0]?.status !== "RUNNING") {
    throw new Error("Restarted World reader did not restore the persisted runtime status");
  }
  await worldStore.applyOpenClawSnapshot({
    observedAt: "2026-08-13T09:16:00.000Z",
    observationId: "isolated-runtime:epoch-1:sequence-2",
    statuses: [{ agentId: ids.agent, bindingId: ids.binding, status: "RUNNING" }],
  });
  await expectRejected(
    worldStore.applyOpenClawSnapshot({
      observedAt: "2026-08-13T09:16:30.000Z",
      observationId: "isolated-runtime:epoch-1:invalid-binding",
      statuses: [
        {
          agentId: ids.agent,
          bindingId: "binding_16161616-1616-1616-1616-161616161616",
          status: "FAILED",
        },
      ],
    }),
    "World projection accepted an unbound runtime identity",
  );
  await worldStore.applyOpenClawSnapshot({
    observedAt: "2026-08-13T09:17:00.000Z",
    observationId: "isolated-runtime:epoch-2:offline",
    statuses: [{ agentId: ids.agent, bindingId: ids.binding, status: "OFFLINE" }],
  });
  const worldEvidence = await pool.query(
    "SELECT count(*)::integer AS event_count, array_agg(sequence ORDER BY sequence) AS sequences FROM agent_world.world_events",
  );
  if (
    worldEvidence.rows[0]?.event_count !== 2 ||
    JSON.stringify(worldEvidence.rows[0]?.sequences) !== JSON.stringify(["1", "2"])
  ) {
    throw new Error(
      "World projection did not preserve gapless replay across duplicate, rollback, and disconnect",
    );
  }
  await pool.query(
    `INSERT INTO agent_world.project_agents (project_id, agent_id, created_at)
     VALUES ($1, $2, $3)`,
    [ids.project, ids.agent, "2026-08-13T08:59:00.000Z"],
  );
  await pool.query(
    `INSERT INTO agent_world.conversations
       (id, agent_id, project_id, title, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [ids.conversation, ids.agent, ids.project, "Protocol review", "2026-08-13T09:00:00.000Z"],
  );
  await pool.query(
    `INSERT INTO agent_world.conversation_sessions
       (id, conversation_id, agent_id, binding_id, adapter_kind,
        external_session_ref, started_at)
     VALUES ($1, $2, $3, $4, 'OPENCLAW', $5, $6)`,
    [
      ids.session,
      ids.conversation,
      ids.agent,
      ids.binding,
      "agent:researcher:protocol-review",
      "2026-08-13T09:30:00.000Z",
    ],
  );
  const taskAssignment = {
    taskId: "task_17171717-1717-1717-1717-171717171717",
    conversationId: ids.conversation,
    agentId: ids.agent,
    title: "Verify the canonical protocol",
    description: "Use primary sources and preserve evidence.",
    idempotencyKey: "task:17171717-1717-1717-1717-171717171717",
    createdAt: "2026-08-13T09:40:00.000Z",
  };
  const assigned = await worldStore.assignTask(taskAssignment);
  if (assigned.outcome !== "CREATED" || assigned.task.approvalRequirement !== "REQUIRED") {
    throw new Error("Task assignment did not persist the required approval policy");
  }
  const assignmentReplay = await worldStore.assignTask({
    ...taskAssignment,
    createdAt: "2026-08-13T09:41:00.000Z",
  });
  if (assignmentReplay.outcome !== "REPLAY") {
    throw new Error("Task assignment did not return an idempotent replay");
  }
  const unrelatedProject = "project_18181818-1818-1818-1818-181818181818";
  await pool.query("INSERT INTO agent_world.projects (id, slug, name) VALUES ($1, $2, $3)", [
    unrelatedProject,
    "unrelated-project",
    "Unrelated project",
  ]);
  await expectRejected(
    pool.query(
      `INSERT INTO agent_world.tasks
         (id, conversation_id, project_id, assignee_agent_id, title,
          approval_requirement, idempotency_key, created_at)
       VALUES ($1, $2, $3, $4, $5, 'REQUIRED', $6, $7)`,
      [
        "task_18181818-1818-1818-1818-181818181818",
        ids.conversation,
        unrelatedProject,
        ids.agent,
        "Cross-context task",
        "task:18181818-1818-1818-1818-181818181818",
        "2026-08-13T09:41:00.000Z",
      ],
    ),
    "Task persistence accepted a Project outside its canonical Conversation scope",
  );
  const taskWorld = await new PostgresWorldProjectionStore(pool).readWorld([worldAgent]);
  if (
    taskWorld.cursor.lastSequence !== 3 ||
    taskWorld.tasks[0]?.approval !== "REQUIRED" ||
    taskWorld.agents[0]?.currentTask?.taskId !== taskAssignment.taskId
  ) {
    throw new Error("Restarted World projection did not restore the canonical Task assignment");
  }
  const runtimeMessageStore = new PostgresRuntimeMessageStore(pool, {
    messageId: () => "message_0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a",
  });
  const inboundHistory = {
    conversationId: ids.conversation,
    sessionId: ids.session,
    agentId: ids.agent,
    bindingId: ids.binding,
    externalSessionKey: "agent:researcher:protocol-review",
    messages: [
      {
        externalMessageId: "openclaw-transcript-message-1",
        content: "The protocol is verified.",
        createdAt: "2026-08-13T09:45:00.000Z",
      },
    ],
  };
  if ((await runtimeMessageStore.receiveOpenClawHistory(inboundHistory)) !== 1) {
    throw new Error("Runtime inbox did not persist the authoritative Agent message");
  }
  if ((await runtimeMessageStore.receiveOpenClawHistory(inboundHistory)) !== 0) {
    throw new Error("Runtime inbox did not deduplicate the authoritative replay");
  }
  await expectRejected(
    runtimeMessageStore.receiveOpenClawHistory({
      ...inboundHistory,
      messages: [{ ...inboundHistory.messages[0], content: "Conflicting replay" }],
    }),
    "Runtime inbox accepted conflicting content for one upstream identity",
  );
  const runtimeMessageEvidence = await pool.query(
    `SELECT count(*)::integer AS message_count
       FROM agent_world.conversation_messages
      WHERE author = 'AGENT'
        AND adapter_kind = 'OPENCLAW'
        AND binding_id = $1
        AND external_message_id = $2`,
    [ids.binding, inboundHistory.messages[0].externalMessageId],
  );
  if (runtimeMessageEvidence.rows[0]?.message_count !== 1) {
    throw new Error("Runtime inbox did not preserve one canonical Agent message");
  }

  const store = new PostgresConversationStore(pool);
  const makeIntent = (
    messageId,
    content = "Verify the protocol.",
    key = `message:${messageId.slice(8)}`,
  ) =>
    SendMessageIntentSchema.parse({
      schemaVersion: 1,
      id: MessageIdSchema.parse(messageId),
      conversationId: ids.conversation,
      agentId: ids.agent,
      content,
      idempotencyKey: key,
      createdAt: "2026-08-13T10:00:00.000Z",
    });
  const firstIntent = makeIntent("message_88888888-8888-8888-8888-888888888888");
  const ready = await store.prepareSend({
    intent: firstIntent,
    acceptedAt: "2026-08-13T10:00:01.000Z",
  });
  if (ready.kind !== "READY" || ready.session.id !== ids.session) {
    throw new Error("PostgreSQL store did not prepare the canonical Session");
  }
  const failed = await store.markFailed({
    messageId: firstIntent.id,
    sessionId: ready.session.id,
    failedAt: "2026-08-13T10:00:02.000Z",
    failureCode: "ADAPTER_REJECTED",
  });
  if (failed.delivery !== "FAILED") {
    throw new Error("PostgreSQL store did not persist a bounded delivery failure");
  }
  const retry = await store.prepareSend({
    intent: firstIntent,
    acceptedAt: "2026-08-13T10:00:03.000Z",
  });
  if (retry.kind !== "READY" || retry.session.id !== ready.session.id) {
    throw new Error("PostgreSQL store did not resume the originally selected Session");
  }
  const dispatched = await store.markDispatched({
    messageId: firstIntent.id,
    sessionId: ready.session.id,
    dispatchedAt: "2026-08-13T10:00:04.000Z",
    receipt: { acceptedAt: "2026-08-13T10:00:04.000Z", externalRequestId: "run-1" },
  });
  if (dispatched.delivery !== "DISPATCHED") {
    throw new Error("PostgreSQL store did not persist dispatch");
  }
  const replay = await store.prepareSend({
    intent: SendMessageIntentSchema.parse({
      ...firstIntent,
      createdAt: "2026-08-13T10:05:00.000Z",
    }),
    acceptedAt: "2026-08-13T10:00:05.000Z",
  });
  if (replay.kind !== "REPLAY") {
    throw new Error("PostgreSQL store did not return an exact completed replay");
  }
  const keyConflict = await store.prepareSend({
    intent: makeIntent(
      "message_99999999-9999-9999-9999-999999999999",
      "Different immutable content.",
      firstIntent.idempotencyKey,
    ),
    acceptedAt: "2026-08-13T10:00:06.000Z",
  });
  if (keyConflict.kind !== "REJECTED" || keyConflict.code !== "IDEMPOTENCY_CONFLICT") {
    throw new Error("PostgreSQL store did not reject idempotency-key reuse");
  }
  const idConflict = await store.prepareSend({
    intent: makeIntent(firstIntent.id, "Different immutable content.", "message:different-key"),
    acceptedAt: "2026-08-13T10:00:07.000Z",
  });
  if (idConflict.kind !== "REJECTED" || idConflict.code !== "IDEMPOTENCY_CONFLICT") {
    throw new Error("PostgreSQL store did not reject canonical message-ID reuse");
  }
  const concurrentIntent = makeIntent("message_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  const concurrent = await Promise.all([
    store.prepareSend({ intent: concurrentIntent, acceptedAt: "2026-08-13T10:00:08.000Z" }),
    store.prepareSend({ intent: concurrentIntent, acceptedAt: "2026-08-13T10:00:08.000Z" }),
  ]);
  if (concurrent.some(({ kind }) => kind !== "READY")) {
    throw new Error("Concurrent exact delivery preparation was not safely serialized");
  }
  const duplicateCount = await pool.query(
    "SELECT count(*)::integer AS count FROM agent_world.conversation_messages WHERE id = $1",
    [concurrentIntent.id],
  );
  if (duplicateCount.rows[0]?.count !== 1) {
    throw new Error("Concurrent preparation created duplicate canonical messages");
  }
  const missing = await store.prepareSend({
    intent: SendMessageIntentSchema.parse({
      ...makeIntent("message_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
      conversationId: "conversation_cccccccc-cccc-cccc-cccc-cccccccccccc",
    }),
    acceptedAt: "2026-08-13T10:00:09.000Z",
  });
  if (missing.kind !== "REJECTED" || missing.code !== "CONVERSATION_NOT_FOUND") {
    throw new Error("PostgreSQL store did not reject a missing Conversation");
  }
  const mismatch = await store.prepareSend({
    intent: SendMessageIntentSchema.parse({
      ...makeIntent("message_dddddddd-dddd-dddd-dddd-dddddddddddd"),
      agentId: "agent_eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    }),
    acceptedAt: "2026-08-13T10:00:10.000Z",
  });
  if (mismatch.kind !== "REJECTED" || mismatch.code !== "AGENT_MISMATCH") {
    throw new Error("PostgreSQL store did not reject an Agent mismatch");
  }
  await pool.query("UPDATE agent_world.conversation_sessions SET ended_at = $2 WHERE id = $1", [
    ids.session,
    "2026-08-13T10:00:11.000Z",
  ]);
  const noSession = await store.prepareSend({
    intent: makeIntent("message_ffffffff-ffff-ffff-ffff-ffffffffffff"),
    acceptedAt: "2026-08-13T10:00:12.000Z",
  });
  if (noSession.kind !== "REJECTED" || noSession.code !== "NO_ACTIVE_SESSION") {
    throw new Error("PostgreSQL store did not reject a Conversation without an active Session");
  }
  await pool.query(
    `INSERT INTO agent_world.conversation_messages (
       id, conversation_id, session_id, agent_id, author, content, delivery,
       created_at, source_kind, adapter_kind, binding_id, external_message_id
     )
     VALUES ($1, $2, $3, $4, 'AGENT', $5, 'RECEIVED', $6, 'RUNTIME',
             'OPENCLAW', $7, $8)`,
    [
      "message_12121212-1212-1212-1212-121212121212",
      ids.conversation,
      ids.session,
      ids.agent,
      "The protocol remains version 4.",
      "2026-08-13T10:00:13.000Z",
      ids.binding,
      "gateway-message-private-locator",
    ],
  );
  const reader = new PostgresConversationReader(pool, {
    now: () => new Date("2026-08-13T10:00:14.000Z"),
  });
  const page = await reader.read({ conversationId: ids.conversation, limit: 2 });
  const serializedPage = JSON.stringify(page);
  if (page?.messages.length !== 2 || !serializedPage.includes("OPENCLAW")) {
    throw new Error("PostgreSQL reader did not produce the expected bounded page");
  }
  for (const forbidden of [ids.session, ids.binding, "gateway-message-private-locator"]) {
    if (serializedPage.includes(forbidden)) {
      throw new Error("PostgreSQL reader leaked a runtime locator into the safe projection");
    }
  }
  const agentConversationIndex = await new PostgresAgentConversationReader(
    pool,
    () => new Date("2026-08-13T10:00:15.000Z"),
  ).read(ids.agent);
  const serializedIndex = JSON.stringify(agentConversationIndex);
  if (
    agentConversationIndex?.conversations.length !== 1 ||
    agentConversationIndex.conversations[0]?.conversationId !== ids.conversation
  ) {
    throw new Error("PostgreSQL reader did not list the Agent's canonical Conversation");
  }
  for (const forbidden of [ids.session, ids.binding, "gateway-message-private-locator"]) {
    if (serializedIndex.includes(forbidden)) {
      throw new Error("PostgreSQL Agent index leaked a runtime locator");
    }
  }

  process.stdout.write(
    `${JSON.stringify({ status: "PASS", postgresImage: IMAGE, migrations: migrations.length, tables: names.length, hubScenarios: 7, conversationStoreScenarios: 11, conversationReaderScenarios: 2, ownerAuthScenarios: 6, worldReplayScenarios: 4, runtimeMessageScenarios: 3, taskAssignmentScenarios: 4 })}\n`,
  );
} finally {
  await pool?.end().catch(() => undefined);
  await runDocker(["rm", "--force", "--volumes", containerName], { allowFailure: true });
}
