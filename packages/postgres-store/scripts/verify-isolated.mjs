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
  const client = await pool.connect();
  try {
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
    ledger.rows.at(-1)?.version !== 4
  ) {
    throw new Error("Migration ledger does not match the discovered migration set");
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
    "conversations",
    "conversation_sessions",
    "conversation_messages",
    "owner_auth_throttle",
    "owner_sessions",
    "runtime_bindings",
    "schema_migrations",
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
  await pool.query("INSERT INTO agent_world.accounts (id, label) VALUES ($1, $2)", [
    ids.account,
    "OpenClaw account",
  ]);
  await pool.query("INSERT INTO agent_world.projects (id, name) VALUES ($1, $2)", [
    ids.project,
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
    `${JSON.stringify({ status: "PASS", postgresImage: IMAGE, migrations: migrations.length, tables: names.length, conversationStoreScenarios: 11, conversationReaderScenarios: 2, ownerAuthScenarios: 6, worldReplayScenarios: 4, runtimeMessageScenarios: 3 })}\n`,
  );
} finally {
  await pool?.end().catch(() => undefined);
  await runDocker(["rm", "--force", "--volumes", containerName], { allowFailure: true });
}
