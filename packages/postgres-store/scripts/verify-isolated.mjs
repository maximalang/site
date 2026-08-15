import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { compileContextPack } from "@agent-world/conversation-service";
import {
  AgentIdSchema,
  AgentSchema,
  ConversationIdSchema,
  MessageIdSchema,
  SendMessageIntentSchema,
} from "@agent-world/domain";
import { ExecutionPreferenceLayerSchema, HubCommandRequestSchema } from "@agent-world/read-model";
import { Pool } from "pg";
import {
  applyMigrations,
  discoverMigrations,
  MemoryGraphProjector,
  PostgresAgentConversationReader,
  PostgresApprovalRunStore,
  PostgresCodexBindingResolver,
  PostgresCodexExecutionStore,
  PostgresCodexWorkerReadinessStore,
  PostgresContextPackStore,
  PostgresConversationReader,
  PostgresConversationStore,
  PostgresEncryptedSecretStore,
  PostgresExecutionPreferenceStore,
  PostgresHubCommandStore,
  PostgresHubReader,
  PostgresIntegrationStore,
  PostgresMemoryCenterReader,
  PostgresMemoryCurationStore,
  PostgresMemoryProjectionStore,
  PostgresMissionHandoffStore,
  PostgresMissionStore,
  PostgresModelExecutionStore,
  PostgresModelRouteResolver,
  PostgresNativeChatControlStore,
  PostgresNativeChatLaunchStore,
  PostgresNativeChatResourceReader,
  PostgresOperationsReader,
  PostgresOwnerSessionStore,
  PostgresResourceBrokerStore,
  PostgresRunContextPackProvider,
  PostgresRunDispatchStore,
  PostgresRunProvenanceReader,
  PostgresRuntimeMessageStore,
  PostgresScheduleStore,
  PostgresSharedContextStore,
  PostgresWorldProjectionStore,
} from "../dist/index.js";

const IMAGE =
  "pgvector/pgvector:0.8.6-pg18-bookworm@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a";
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

  let sqlReady = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      sqlReady = true;
      break;
    } catch (error) {
      if (error?.code !== "57P03") throw error;
      await delay(250);
    }
  }
  if (!sqlReady) {
    throw new Error("Timed out waiting for isolated PostgreSQL SQL readiness");
  }

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
    ledger.rows.at(-1)?.version !== 40
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
    "artifacts",
    "agents",
    "agent_skills",
    "agent_schedules",
    "agent_templates",
    "agent_template_skills",
    "agent_template_tools",
    "agent_instance_assignments",
    "agent_tools",
    "account_surfaces",
    "canonical_models",
    "canonical_model_modalities",
    "conversations",
    "conversation_sessions",
    "conversation_messages",
    "codex_execution_events",
    "codex_execution_jobs",
    "codex_execution_policies",
    "codex_worker_readiness",
    "hub_command_receipts",
    "integration_command_receipts",
    "integration_endpoints",
    "integration_probe_observations",
    "execution_preference_overrides",
    "encrypted_secrets",
    "approvals",
    "runs",
    "model_routes",
    "model_route_modalities",
    "model_route_reasoning_efforts",
    "model_route_tools",
    "native_chat_control_events",
    "native_chat_browser_profiles",
    "native_chat_dispatches",
    "native_chat_results",
    "native_chat_resource_pulls",
    "owner_auth_throttle",
    "owner_sessions",
    "project_agents",
    "providers",
    "context_items",
    "context_pack_evidence",
    "context_packs",
    "memory_curation_decisions",
    "memory_events",
    "memory_projection_checkpoints",
    "memory_proposals",
    "missions",
    "mission_collaboration_events",
    "mission_decomposition_dependencies",
    "mission_decompositions",
    "mission_decomposition_tasks",
    "mission_handoff_activations",
    "mission_handoffs",
    "mission_success_criteria",
    "mission_task_dependencies",
    "rag_document_chunks",
    "rag_document_sources",
    "rag_documents",
    "resource_broker_decisions",
    "resource_broker_events",
    "resource_route_observations",
    "runtime_bindings",
    "schema_migrations",
    "schedule_firings",
    "secret_write_receipts",
    "skills",
    "structured_meetings",
    "structured_meeting_agents",
    "structured_meeting_criterion_assessments",
    "structured_meeting_sources",
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
  const vectorExtension = await pool.query(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  if (vectorExtension.rows[0]?.extversion !== "0.8.6") {
    throw new Error("Canonical PostgreSQL does not expose the pinned pgvector extension");
  }
  const vectorIndex = await pool.query(
    `SELECT indexdef
       FROM pg_indexes
      WHERE schemaname = 'agent_world'
        AND indexname = 'rag_document_chunks_embedding_hnsw'`,
  );
  if (!vectorIndex.rows[0]?.indexdef?.includes("USING hnsw (embedding vector_cosine_ops)")) {
    throw new Error("Shared context does not expose the required cosine HNSW index");
  }
  const oauthTables = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'agent_world_oauth' ORDER BY table_name`,
  );
  const oauthNames = oauthTables.rows.map(({ table_name: tableName }) => tableName);
  for (const required of ["account_grants", "login_throttle", "oidc_store"]) {
    if (!oauthNames.includes(required)) {
      throw new Error(`Native Chat OAuth table is missing after migration: ${required}`);
    }
  }

  const secretMasterKey = randomBytes(32);
  const secretStore = new PostgresEncryptedSecretStore(pool, {
    keyVersion: 1,
    masterKey: secretMasterKey,
  });
  const secretRef = "secret-store:provider/isolated/api-key";
  const firstSecret = "isolated-provider-key-first";
  const firstSecretReceipt = await secretStore.write({
    commandId: "isolated-secret-write-1",
    secretRef,
    purpose: "PROVIDER_API_KEY",
    plaintext: firstSecret,
    writtenAt: "2026-08-13T07:30:00.000Z",
  });
  if (
    firstSecretReceipt.outcome !== "CREATED" ||
    (await secretStore.read(secretRef, "PROVIDER_API_KEY")) !== firstSecret
  ) {
    throw new Error("Encrypted SecretStore did not round-trip its first version");
  }
  const encryptedRow = await pool.query(
    `SELECT version, nonce, ciphertext, auth_tag
       FROM agent_world.encrypted_secrets
      WHERE secret_ref = $1`,
    [secretRef],
  );
  if (
    encryptedRow.rows[0]?.version !== 1 ||
    encryptedRow.rows[0]?.nonce?.length !== 12 ||
    encryptedRow.rows[0]?.auth_tag?.length !== 16 ||
    encryptedRow.rows[0]?.ciphertext?.includes(Buffer.from(firstSecret, "utf8"))
  ) {
    throw new Error("Encrypted SecretStore persisted an invalid ciphertext envelope");
  }
  const firstNonce = Buffer.from(encryptedRow.rows[0].nonce);
  const rotatedSecret = "isolated-provider-key-rotated";
  const rotatedReceipt = await secretStore.write({
    commandId: "isolated-secret-write-2",
    secretRef,
    purpose: "PROVIDER_API_KEY",
    plaintext: rotatedSecret,
    writtenAt: "2026-08-13T07:31:00.000Z",
  });
  const rotatedRow = await pool.query(
    "SELECT version, nonce FROM agent_world.encrypted_secrets WHERE secret_ref = $1",
    [secretRef],
  );
  if (
    rotatedReceipt.outcome !== "ROTATED" ||
    rotatedReceipt.version !== 2 ||
    Buffer.from(rotatedRow.rows[0]?.nonce ?? []).equals(firstNonce) ||
    (await secretStore.read(secretRef, "PROVIDER_API_KEY")) !== rotatedSecret
  ) {
    throw new Error("Encrypted SecretStore did not rotate atomically with a fresh nonce");
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
  const contextIds = {
    otherProject: "project_56565656-5656-5656-5656-565656565656",
    document: "document_57575757-5757-5757-5757-575757575757",
    duplicateDocument: "document_58585858-5858-5858-5858-585858585858",
    otherDocument: "document_59595959-5959-5959-5959-595959595959",
    chunk: "document_chunk_60606060-6060-6060-6060-606060606060",
    duplicateChunk: "document_chunk_61616161-6161-6161-6161-616161616161",
    otherChunk: "document_chunk_62626262-6262-6262-6262-626262626262",
  };
  await pool.query("INSERT INTO agent_world.projects (id, slug, name) VALUES ($1, $2, $3)", [
    contextIds.otherProject,
    "isolated-other-project",
    "Isolated other project",
  ]);
  const contextStore = new PostgresSharedContextStore(pool);
  const contextTimestamp = "2026-08-13T08:30:00.000Z";
  const vectorA = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));
  const vectorB = Array.from({ length: 1536 }, (_, index) => (index === 1 ? 1 : 0));
  const documentReceipt = await contextStore.ingestDocument({
    schemaVersion: 1,
    id: contextIds.document,
    projectId: ids.project,
    title: "Canonical project evidence",
    contentHash: "d".repeat(64),
    mimeType: "text/markdown",
    byteSize: 128,
    source: { kind: "PROJECT_FILE", ref: "docs/evidence.md", observedAt: contextTimestamp },
    createdAt: contextTimestamp,
  });
  const duplicateDocumentReceipt = await contextStore.ingestDocument({
    schemaVersion: 1,
    id: contextIds.duplicateDocument,
    projectId: ids.project,
    title: "Canonical project evidence duplicate",
    contentHash: "d".repeat(64),
    mimeType: "text/markdown",
    byteSize: 128,
    source: { kind: "UPLOAD", ref: "evidence.md", observedAt: contextTimestamp },
    createdAt: contextTimestamp,
  });
  await contextStore.ingestDocument({
    schemaVersion: 1,
    id: contextIds.otherDocument,
    projectId: contextIds.otherProject,
    title: "Other project evidence",
    contentHash: "e".repeat(64),
    mimeType: "text/plain",
    byteSize: 64,
    source: { kind: "UPLOAD", ref: "other.txt", observedAt: contextTimestamp },
    createdAt: contextTimestamp,
  });
  const chunkReceipt = await contextStore.writeChunk({
    schemaVersion: 1,
    id: contextIds.chunk,
    contextItemId: "context_item_60606060-6060-6060-6060-606060606060",
    documentId: contextIds.document,
    projectId: ids.project,
    ordinal: 0,
    content: "PostgreSQL is canonical.",
    contentHash: "f".repeat(64),
    estimatedTokens: 6,
    temperature: "WARM",
    importance: 0.9,
    embeddingModel: "isolated-1536",
    embedding: vectorA,
    createdAt: contextTimestamp,
  });
  const duplicateChunkReceipt = await contextStore.writeChunk({
    schemaVersion: 1,
    id: contextIds.duplicateChunk,
    contextItemId: "context_item_61616161-6161-6161-6161-616161616161",
    documentId: contextIds.document,
    projectId: ids.project,
    ordinal: 1,
    content: "PostgreSQL is canonical.",
    contentHash: "f".repeat(64),
    estimatedTokens: 6,
    temperature: "WARM",
    importance: 0.9,
    embeddingModel: "isolated-1536",
    embedding: vectorA,
    createdAt: contextTimestamp,
  });
  await contextStore.writeChunk({
    schemaVersion: 1,
    id: contextIds.otherChunk,
    contextItemId: "context_item_62626262-6262-6262-6262-626262626262",
    documentId: contextIds.otherDocument,
    projectId: contextIds.otherProject,
    ordinal: 0,
    content: "This closer evidence belongs to another project.",
    contentHash: "0".repeat(64),
    estimatedTokens: 10,
    temperature: "WARM",
    importance: 0.9,
    embeddingModel: "isolated-1536",
    embedding: vectorB,
    createdAt: contextTimestamp,
  });
  const retrievedContext = await contextStore.retrieve({
    schemaVersion: 1,
    projectId: ids.project,
    embedding: vectorB,
    maxItems: 5,
  });
  if (
    documentReceipt.outcome !== "CREATED" ||
    duplicateDocumentReceipt.outcome !== "DEDUPLICATED" ||
    duplicateDocumentReceipt.documentId !== contextIds.document ||
    chunkReceipt.outcome !== "CREATED" ||
    chunkReceipt.contextItemId !== "context_item_60606060-6060-6060-6060-606060606060" ||
    duplicateChunkReceipt.outcome !== "DEDUPLICATED" ||
    duplicateChunkReceipt.chunkId !== contextIds.chunk ||
    duplicateChunkReceipt.contextItemId !== chunkReceipt.contextItemId ||
    retrievedContext.length !== 1 ||
    retrievedContext[0]?.projectId !== ids.project ||
    retrievedContext[0]?.chunkId !== contextIds.chunk
  ) {
    throw new Error("Shared context idempotency, retrieval, or project isolation drifted");
  }
  const memoryIds = {
    proposal: "memory_proposal_70707070-7070-7070-7070-707070707070",
    duplicateProposal: "memory_proposal_71717171-7171-7171-7171-717171717171",
    crossProjectProposal: "memory_proposal_79797979-7979-7979-7979-797979797979",
    mergeProposal: "memory_proposal_72727272-7272-7272-7272-727272727272",
    rejectProposal: "memory_proposal_73737373-7373-7373-7373-737373737373",
    decision: "memory_decision_74747474-7474-7474-7474-747474747474",
    conflictDecision: "memory_decision_75757575-7575-7575-7575-757575757575",
    mergeDecision: "memory_decision_76767676-7676-7676-7676-767676767676",
    rejectDecision: "memory_decision_77777777-7777-7777-7777-777777777777",
    context: "context_item_78787878-7878-7878-7878-787878787878",
    events: [
      "event_80808080-8080-8080-8080-808080808080",
      "event_81818181-8181-8181-8181-818181818181",
      "event_82828282-8282-8282-8282-828282828282",
      "event_83838383-8383-8383-8383-838383838383",
      "event_84848484-8484-8484-8484-848484848484",
      "event_85858585-8585-8585-8585-858585858585",
    ],
  };
  let memoryEventIndex = 0;
  const memoryStore = new PostgresMemoryCurationStore(pool, {
    contextItemId: () => memoryIds.context,
    eventId: () => memoryIds.events[memoryEventIndex++],
  });
  const memoryProposal = {
    schemaVersion: 1,
    id: memoryIds.proposal,
    projectId: ids.project,
    sourceContextItemId: chunkReceipt.contextItemId,
    content: "Canonical memory is curated and provenance-linked.",
    contentHash: "1".repeat(64),
    estimatedTokens: 9,
    importance: 0.95,
    status: "PENDING",
    createdAt: "2026-08-13T08:31:00.000Z",
  };
  const proposed = await memoryStore.propose(memoryProposal);
  const duplicateProposal = await memoryStore.propose({
    ...memoryProposal,
    id: memoryIds.duplicateProposal,
  });
  await expectRejected(
    memoryStore.propose({
      ...memoryProposal,
      id: memoryIds.crossProjectProposal,
      projectId: contextIds.otherProject,
    }),
    "Memory Inbox accepted provenance from another project",
  );
  const acceptDecision = {
    schemaVersion: 1,
    id: memoryIds.decision,
    proposalId: memoryIds.proposal,
    projectId: ids.project,
    action: "ACCEPT",
    idempotencyKey: "memory:isolated-accept",
    decidedAt: "2026-08-13T08:32:00.000Z",
  };
  const accepted = await memoryStore.decide(acceptDecision);
  const replayed = await new PostgresMemoryCurationStore(pool).decide(acceptDecision);
  await expectRejected(
    memoryStore.decide({
      ...acceptDecision,
      id: memoryIds.conflictDecision,
      action: "REJECT",
      idempotencyKey: "memory:isolated-conflict",
    }),
    "Memory Inbox accepted a second terminal decision",
  );
  await memoryStore.propose({
    ...memoryProposal,
    id: memoryIds.mergeProposal,
    content: "This evidence is already represented by accepted memory.",
    contentHash: "2".repeat(64),
    createdAt: "2026-08-13T08:33:00.000Z",
  });
  const merged = await memoryStore.decide({
    schemaVersion: 1,
    id: memoryIds.mergeDecision,
    proposalId: memoryIds.mergeProposal,
    projectId: ids.project,
    action: "MERGE",
    targetContextItemId: memoryIds.context,
    idempotencyKey: "memory:isolated-merge",
    decidedAt: "2026-08-13T08:34:00.000Z",
  });
  await memoryStore.propose({
    ...memoryProposal,
    id: memoryIds.rejectProposal,
    content: "Untrusted speculation must not become memory.",
    contentHash: "3".repeat(64),
    createdAt: "2026-08-13T08:35:00.000Z",
  });
  const rejected = await memoryStore.decide({
    schemaVersion: 1,
    id: memoryIds.rejectDecision,
    proposalId: memoryIds.rejectProposal,
    projectId: ids.project,
    action: "REJECT",
    idempotencyKey: "memory:isolated-reject",
    decidedAt: "2026-08-13T08:36:00.000Z",
  });
  const memoryEvidence = await pool.query(
    `SELECT proposal.status, memory.kind, memory.provenance_kind,
            memory.document_chunk_id,
            (SELECT count(*)::integer FROM agent_world.memory_curation_decisions
              WHERE project_id = $1) AS decisions,
            (SELECT count(*)::integer FROM agent_world.memory_events
              WHERE project_id = $1) AS events,
            (SELECT array_agg(event_type ORDER BY sequence) FROM agent_world.memory_events
              WHERE project_id = $1) AS event_types
       FROM agent_world.memory_proposals proposal
       JOIN agent_world.context_items memory ON memory.id = $2
      WHERE proposal.id = $3 AND proposal.project_id = $1`,
    [ids.project, memoryIds.context, memoryIds.proposal],
  );
  if (
    proposed.outcome !== "CREATED" ||
    duplicateProposal.outcome !== "DEDUPLICATED" ||
    accepted.status !== "ACCEPTED" ||
    accepted.materializedContextItemId !== memoryIds.context ||
    replayed.outcome !== "REPLAYED" ||
    merged.status !== "MERGED" ||
    merged.materializedContextItemId !== memoryIds.context ||
    rejected.status !== "REJECTED" ||
    memoryEvidence.rows[0]?.status !== "ACCEPTED" ||
    memoryEvidence.rows[0]?.kind !== "MEMORY" ||
    memoryEvidence.rows[0]?.provenance_kind !== "DOCUMENT_CHUNK" ||
    memoryEvidence.rows[0]?.document_chunk_id !== contextIds.chunk ||
    memoryEvidence.rows[0]?.decisions !== 3 ||
    memoryEvidence.rows[0]?.events !== 6 ||
    JSON.stringify(memoryEvidence.rows[0]?.event_types) !==
      JSON.stringify([
        "MEMORY_PROPOSED",
        "MEMORY_CURATED",
        "MEMORY_PROPOSED",
        "MEMORY_CURATED",
        "MEMORY_PROPOSED",
        "MEMORY_CURATED",
      ])
  ) {
    throw new Error("Memory curation lifecycle or exact provenance drifted");
  }
  const memoryReader = new PostgresMemoryCenterReader(pool);
  const [memoryInbox, memoryTimeline, memoryNetwork] = await Promise.all([
    memoryReader.inbox(ids.project, 50),
    memoryReader.timeline(ids.project, 50),
    memoryReader.network(ids.project, 50),
  ]);
  const projectedEventIds = [];
  const memoryProjectionStore = new PostgresMemoryProjectionStore(pool);
  const graphPort = {
    apply: async (events) => {
      projectedEventIds.push(...events.map(({ eventId }) => eventId));
      return { appliedThrough: events.at(-1)?.sequence ?? 0 };
    },
  };
  const projected = await new MemoryGraphProjector(memoryProjectionStore, graphPort, {
    projectionName: "graphiti",
    now: () => "2026-08-13T08:37:00.000Z",
  }).runBatch(100);
  const replayAfterRestart = await new MemoryGraphProjector(
    new PostgresMemoryProjectionStore(pool),
    graphPort,
    { projectionName: "graphiti", now: () => "2026-08-13T08:38:00.000Z" },
  ).runBatch(100);
  if (
    memoryInbox.proposals.length !== 0 ||
    memoryTimeline.entries.length !== 3 ||
    memoryTimeline.entries
      .map(({ action }) => action)
      .toSorted()
      .join(",") !== "ACCEPT,MERGE,REJECT" ||
    memoryNetwork.nodes.length !== 1 ||
    memoryNetwork.nodes[0]?.contextItemId !== memoryIds.context ||
    memoryNetwork.edges.length !== 2 ||
    projected.applied !== 6 ||
    projected.appliedThrough !== 6 ||
    projectedEventIds.length !== 6 ||
    replayAfterRestart.applied !== 0 ||
    replayAfterRestart.appliedThrough !== 6
  ) {
    throw new Error("Memory Center projections or graph replay checkpoint drifted");
  }
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
  await secretStore.write({
    commandId: "isolated-openai-account-secret",
    secretRef: "secret-store:accounts/openai-primary",
    purpose: "PROVIDER_API_KEY",
    plaintext: "isolated-openai-key",
    writtenAt: "2026-08-13T09:00:00.000Z",
  });
  const routeResolver = new PostgresModelRouteResolver(pool);
  const resolvedModelRoute = await routeResolver.resolve(hub.primaryModelRoute);
  if (
    resolvedModelRoute.modelAlias !== `route-${hub.primaryModelRoute}` ||
    resolvedModelRoute.providerModel !== "openai/gpt-x-2026-08-01" ||
    resolvedModelRoute.credentialRef !== "secret-store:accounts/openai-primary"
  ) {
    throw new Error("PostgreSQL route resolver did not resolve the eligible API route");
  }
  await expectRejected(
    routeResolver.resolve(hub.secondaryModelRoute),
    "PostgreSQL route resolver accepted a degraded route/account",
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
  const hubProjection = await new PostgresHubReader(
    pool,
    () => new Date("2026-08-13T12:00:00.000Z"),
  ).read();
  const serializedHub = JSON.stringify(hubProjection);
  if (
    hubProjection.models.length !== 1 ||
    hubProjection.models[0]?.routes.length !== 2 ||
    hubProjection.accounts.length !== 4 ||
    !hubProjection.agents.some(({ agentId }) => agentId === hub.secondaryAgent)
  ) {
    throw new Error("PostgreSQL Hub reader did not preserve canonical nested identities");
  }
  if (
    /credentialRef|configurationRef|sourceRef|instructions|binding_|session_|secret-store|vault:/.test(
      serializedHub,
    )
  ) {
    throw new Error("PostgreSQL Hub reader leaked a private or runtime locator");
  }
  const hubCommandStore = new PostgresHubCommandStore(
    pool,
    () => new Date("2026-08-13T12:01:00.000Z"),
  );
  const providerCreate = HubCommandRequestSchema.parse({
    schemaVersion: 1,
    commandId: "hub_command_b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1",
    kind: "PROVIDER_CREATE",
    providerId: "provider_b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
    slug: "local-models",
    displayName: "Local models",
    providerKind: "OLLAMA",
    category: "LOCAL_MODEL",
    baseUrl: "http://127.0.0.1:11434",
  });
  if ((await hubCommandStore.execute(providerCreate)).outcome !== "CREATED") {
    throw new Error("Hub command did not create the canonical Provider");
  }
  if ((await hubCommandStore.execute(providerCreate)).outcome !== "REPLAY") {
    throw new Error("Hub command did not replay the exact committed request");
  }
  await expectRejected(
    hubCommandStore.execute({ ...providerCreate, displayName: "Conflicting Provider" }),
    "Hub command accepted conflicting immutable input for one command identity",
  );
  await expectRejected(
    hubCommandStore.execute(
      HubCommandRequestSchema.parse({
        schemaVersion: 1,
        commandId: "hub_command_b3b3b3b3-b3b3-b3b3-b3b3-b3b3b3b3b3b3",
        kind: "MODEL_ROUTE_CREATE",
        modelRouteId: "model_route_b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4",
        canonicalModelId: hub.model,
        providerId: openClawProviderId,
        accountId: hub.primaryAccount,
        surface: "API",
        remoteModelId: "cross-provider-command",
        availability: "UNKNOWN",
        contextWindowTokens: 200000,
        reasoningEfforts: [],
        supportedModalities: ["TEXT"],
        supportedToolIds: [],
      }),
    ),
    "Hub command accepted a ModelRoute under the wrong Account Provider",
  );
  await expectRejected(
    hubCommandStore.execute(
      HubCommandRequestSchema.parse({
        schemaVersion: 1,
        commandId: "hub_command_b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5",
        kind: "MODEL_ROUTE_CREATE",
        modelRouteId: "model_route_b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6",
        canonicalModelId: hub.model,
        providerId: hub.provider,
        accountId: hub.primaryAccount,
        surface: "API",
        remoteModelId: "gpt-x-2026-08-01",
        availability: "UNKNOWN",
        contextWindowTokens: 200000,
        reasoningEfforts: [],
        supportedModalities: ["TEXT"],
        supportedToolIds: [],
      }),
    ),
    "Hub command accepted duplicate remote Model discovery",
  );
  const provisionedAgentId = "agent_b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7";
  const provisionAgent = HubCommandRequestSchema.parse({
    schemaVersion: 1,
    commandId: "hub_command_b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7",
    kind: "AGENT_CREATE",
    agentId: provisionedAgentId,
    slug: "atomic-provisioned-agent",
    displayName: "Atomic Provisioned Agent",
    role: "Verify atomic provisioning",
    instructions: "Use the canonical PostgreSQL state only.",
    provisioning: {
      templateId: "agent_template_b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7",
      templateVersion: 1,
      projectId: ids.project,
      skillIds: [hub.skill],
      toolIds: [hub.tool],
      preferences: { mode: "AUTO", context: "RICH", budget: "QUALITY" },
    },
  });
  if ((await hubCommandStore.execute(provisionAgent)).outcome !== "CREATED") {
    throw new Error("Hub command did not provision the Agent Template and Instance");
  }
  const apiExecutionRouteId = "route_b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8";
  const apiBindingId = "binding_b9b9b9b9-b9b9-49b9-89b9-b9b9b9b9b9b9";
  const apiSessionId = "session_babababa-baba-4aba-8aba-babababababa";
  const apiConversationId = "conversation_bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc";
  const provisionApiConnection = HubCommandRequestSchema.parse({
    schemaVersion: 1,
    commandId: "hub_command_b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8",
    kind: "MODEL_AGENT_ROUTE_PROVISION",
    routeId: apiExecutionRouteId,
    modelRouteId: hub.primaryModelRoute,
    routeLabel: "Primary API execution",
    bindingId: apiBindingId,
    sessionId: apiSessionId,
    agentId: provisionedAgentId,
    projectId: ids.project,
    conversationId: apiConversationId,
    conversationTitle: "API execution proof",
    externalAgentId: "api-model:atomic-provisioned-agent",
    externalSessionRef: "api-model:isolated-session",
    startedAt: "2026-08-13T12:03:00.000Z",
  });
  if ((await hubCommandStore.execute(provisionApiConnection)).outcome !== "CREATED") {
    throw new Error("Hub command did not atomically provision the API execution connection");
  }
  const apiBindingEvidence = await pool.query(
    `SELECT route.mode, route.adapter_kind, route.model_route_id,
            binding.agent_id, session.conversation_id, session.ended_at
       FROM agent_world.execution_routes route
       JOIN agent_world.runtime_bindings binding ON binding.route_id = route.id
       JOIN agent_world.conversation_sessions session ON session.binding_id = binding.id
      WHERE route.id = $1 AND binding.id = $2 AND session.id = $3`,
    [apiExecutionRouteId, apiBindingId, apiSessionId],
  );
  if (
    apiBindingEvidence.rows[0]?.mode !== "API" ||
    apiBindingEvidence.rows[0]?.adapter_kind !== "API_MODEL" ||
    apiBindingEvidence.rows[0]?.model_route_id !== hub.primaryModelRoute ||
    apiBindingEvidence.rows[0]?.agent_id !== provisionedAgentId ||
    apiBindingEvidence.rows[0]?.conversation_id !== apiConversationId ||
    apiBindingEvidence.rows[0]?.ended_at !== null
  ) {
    throw new Error("API execution route binding provenance drifted after commit");
  }
  const apiTaskId = "task_bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd";
  const apiApprovalId = "approval_bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd";
  const apiRunId = "run_bebebebe-bebe-4ebe-8ebe-bebebebebebe";
  const apiExecutionId = "model_execution_bfbfbfbf-bfbf-4fbf-8fbf-bfbfbfbfbfbf";
  await pool.query(
    `INSERT INTO agent_world.tasks
       (id, conversation_id, project_id, assignee_agent_id, title, description,
        approval_requirement, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, 'Prove API execution', 'Persist exact usage and cost.',
             'REQUIRED', 'task:api-model-lifecycle', '2026-08-13T12:04:00.000Z')`,
    [apiTaskId, apiConversationId, ids.project, provisionedAgentId],
  );
  await pool.query(
    `INSERT INTO agent_world.approvals
       (id, task_id, state, requested_at, expires_at, decided_at, decision_command_id)
     VALUES ($1, $2, 'APPROVED', '2026-08-13T12:04:00.000Z',
             '2026-08-14T12:04:00.000Z', '2026-08-13T12:05:00.000Z',
             'approve:api-model-lifecycle')`,
    [apiApprovalId, apiTaskId],
  );
  await pool.query(
    `INSERT INTO agent_world.runs
       (id, task_id, conversation_id, agent_id, approval_id, adapter_kind,
        binding_id, session_id, status, dispatch_idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, $5, 'API_MODEL', $6, $7, 'DISPATCH_PENDING',
             'run:api-model-lifecycle', '2026-08-13T12:06:00.000Z')`,
    [
      apiRunId,
      apiTaskId,
      apiConversationId,
      provisionedAgentId,
      apiApprovalId,
      apiBindingId,
      apiSessionId,
    ],
  );
  const modelExecutionRequest = {
    schemaVersion: 1,
    adapterKind: "API_MODEL",
    runId: apiRunId,
    taskId: apiTaskId,
    agentId: provisionedAgentId,
    bindingId: apiBindingId,
    sessionId: apiSessionId,
    routeId: apiExecutionRouteId,
    modelRouteId: hub.primaryModelRoute,
    idempotencyKey: "api-model:isolated-lifecycle",
    prompt: "Return a structured verification result.",
    maxOutputTokens: 1024,
  };
  const modelExecutionStore = new PostgresModelExecutionStore(pool, {
    contextItemId: () => "context_item_c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1",
    memoryProposalId: () => "memory_proposal_c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2",
    memoryEventId: () => "event_c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3",
  });
  const modelResolution = await modelExecutionStore.resolve({
    bindingId: apiBindingId,
    agentId: provisionedAgentId,
    adapterKind: "API_MODEL",
  });
  if (
    modelResolution.routeId !== apiExecutionRouteId ||
    modelResolution.modelRouteId !== hub.primaryModelRoute ||
    modelResolution.mode !== "API"
  ) {
    throw new Error("Model execution binding resolver lost canonical route provenance");
  }
  const preparedModelExecution = await modelExecutionStore.prepare(
    modelExecutionRequest,
    apiExecutionId,
    "2026-08-13T12:07:00.000Z",
  );
  if (preparedModelExecution.outcome !== "EXECUTE") {
    throw new Error("First model execution preparation did not claim the paid call exactly once");
  }
  await modelExecutionStore.complete(
    apiExecutionId,
    {
      schemaVersion: 1,
      runId: apiRunId,
      modelRouteId: hub.primaryModelRoute,
      upstreamRequestId: "litellm-isolated-request",
      finishReason: "STOP",
      content: JSON.stringify({
        schemaVersion: 1,
        fullOutput: "API execution persisted with canonical provenance.",
        summary: "API execution persisted.",
        findings: ["Durable model execution is restart-safe."],
        decisions: [],
        actions: ["Recorded usage and estimated cost."],
        artifacts: [],
        openQuestions: [],
        nextActions: [],
        memoryCandidates: [
          {
            statement: "API model results enter shared memory only after schema validation.",
            confidence: 1,
            importance: 0.9,
          },
        ],
        confidence: 1,
      }),
      toolCalls: [],
      usage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 30, totalTokens: 150 },
      monetaryCost: { amountUsd: 0.00042, source: "LITELLM_RESPONSE_HEADER", estimated: true },
    },
    "2026-08-13T12:08:00.000Z",
  );
  const replayedModelExecution = await new PostgresModelExecutionStore(pool).prepare(
    modelExecutionRequest,
    "model_execution_c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0",
    "2026-08-13T12:09:00.000Z",
  );
  const observedModelExecution = await new PostgresModelExecutionStore(pool).observe(
    apiExecutionId,
    "2026-08-13T12:10:00.000Z",
  );
  const modelExecutionEvidence = await pool.query(
    `SELECT status, input_tokens, cached_input_tokens, output_tokens,
            cost_usd::text, cost_source, cost_estimated,
            result->>'upstreamRequestId' AS upstream_request_id,
            (SELECT count(*)::integer FROM agent_world.context_items context
              WHERE context.run_id = jobs.run_id AND context.kind = 'AGENT_RESULT') AS result_context,
            (SELECT count(*)::integer FROM agent_world.memory_proposals proposal
              WHERE proposal.source_context_item_id =
                'context_item_c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1') AS memory_proposals,
            (SELECT count(*)::integer FROM agent_world.memory_events event
              WHERE event.proposal_id =
                'memory_proposal_c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2') AS memory_events
       FROM agent_world.model_execution_jobs jobs WHERE id = $1`,
    [apiExecutionId],
  );
  if (
    replayedModelExecution.outcome !== "REPLAY" ||
    replayedModelExecution.externalRunId !== apiExecutionId ||
    replayedModelExecution.acceptedAt !== "2026-08-13T12:07:00.000Z" ||
    observedModelExecution.status !== "COMPLETED" ||
    modelExecutionEvidence.rows[0]?.status !== "COMPLETED" ||
    modelExecutionEvidence.rows[0]?.input_tokens !== "120" ||
    modelExecutionEvidence.rows[0]?.cached_input_tokens !== "20" ||
    modelExecutionEvidence.rows[0]?.output_tokens !== "30" ||
    Number(modelExecutionEvidence.rows[0]?.cost_usd) !== 0.00042 ||
    modelExecutionEvidence.rows[0]?.cost_source !== "LITELLM_RESPONSE_HEADER" ||
    modelExecutionEvidence.rows[0]?.cost_estimated !== true ||
    modelExecutionEvidence.rows[0]?.upstream_request_id !== "litellm-isolated-request" ||
    modelExecutionEvidence.rows[0]?.result_context !== 1 ||
    modelExecutionEvidence.rows[0]?.memory_proposals !== 1 ||
    modelExecutionEvidence.rows[0]?.memory_events !== 1
  ) {
    throw new Error("Restarted model execution store did not replay exact usage/cost provenance");
  }
  const commandEvidence = await pool.query(
    `SELECT
       (SELECT count(*)::integer FROM agent_world.providers WHERE id = $1) AS providers,
       (SELECT count(*)::integer FROM agent_world.hub_command_receipts) AS receipts,
       (SELECT count(*)::integer FROM agent_world.model_routes
         WHERE id IN ($2, $3)) AS rejected_routes,
       (SELECT count(*)::integer FROM agent_world.agent_instance_assignments
         WHERE agent_id = $4) AS assignments,
       (SELECT count(*)::integer FROM agent_world.execution_preference_overrides
         WHERE agent_id = $4 AND context_policy = 'RICH' AND budget_policy = 'QUALITY') AS preferences`,
    [
      providerCreate.providerId,
      "model_route_b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4",
      "model_route_b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6",
      provisionedAgentId,
    ],
  );
  if (
    commandEvidence.rows[0]?.providers !== 1 ||
    commandEvidence.rows[0]?.receipts !== 3 ||
    commandEvidence.rows[0]?.rejected_routes !== 0 ||
    commandEvidence.rows[0]?.assignments !== 1 ||
    commandEvidence.rows[0]?.preferences !== 1
  ) {
    throw new Error("Hub command transaction or receipt authority drifted");
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
    "event_17171717-1717-1717-1717-171717171717",
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
     VALUES ($1, $2, $4), ($1, $3, $4)`,
    [ids.project, ids.agent, hub.secondaryAgent, "2026-08-13T08:59:00.000Z"],
  );
  const collaborationEventIds = [
    "event_a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
    "event_a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2",
    "event_a6a6a6a6-a6a6-a6a6-a6a6-a6a6a6a6a6a6",
    "event_a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7",
    "event_a8a8a8a8-a8a8-a8a8-a8a8-a8a8a8a8a8a8",
    "event_a9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9",
  ];
  const missionStore = new PostgresMissionStore(pool, {
    eventId: () => {
      const eventId = collaborationEventIds.shift();
      if (!eventId) throw new Error("Isolated Mission collaboration identities were exhausted");
      return eventId;
    },
  });
  const mission = {
    schemaVersion: 1,
    id: "mission_19191919-1919-1919-1919-191919191919",
    projectId: ids.project,
    title: "Verify the canonical protocol",
    goal: "Complete protocol verification with replayable evidence.",
    status: "ACTIVE",
    executionPolicy: "AUTO_SAFE_HANDOFF",
    successCriteria: [
      {
        id: "mission_criterion_20202020-2020-2020-2020-202020202020",
        statement: "The isolated verifier passes.",
        verification: "TEST",
        status: "PENDING",
        evidenceRefs: [],
      },
    ],
    createdAt: "2026-08-13T08:57:00.000Z",
    updatedAt: "2026-08-13T08:57:00.000Z",
  };
  const template = {
    schemaVersion: 1,
    id: "agent_template_21212121-2121-2121-2121-212121212121",
    version: 1,
    slug: "protocol-researcher",
    displayName: "Protocol Researcher",
    role: "Evidence-first protocol verification",
    instructions: "Verify canonical contracts and preserve evidence.",
    skillIds: [],
    toolIds: [],
    createdAt: "2026-08-13T08:58:00.000Z",
  };
  if (
    (await missionStore.createMission(mission)).outcome !== "CREATED" ||
    (await missionStore.createMission(mission)).outcome !== "REPLAY" ||
    (await missionStore.createTemplate(template)).outcome !== "CREATED" ||
    (await missionStore.createTemplate(template)).outcome !== "REPLAY"
  ) {
    throw new Error("Mission or Agent Template idempotency drifted");
  }
  const assignment = {
    schemaVersion: 1,
    agentId: ids.agent,
    templateId: template.id,
    templateVersion: template.version,
    projectId: ids.project,
    missionId: mission.id,
    createdAt: "2026-08-13T08:59:00.000Z",
  };
  if (
    (await missionStore.assignAgent(assignment)).outcome !== "CREATED" ||
    (await missionStore.assignAgent(assignment)).outcome !== "REPLAY"
  ) {
    throw new Error("Agent Instance assignment idempotency drifted");
  }
  await expectRejected(
    missionStore.createMission({ ...mission, goal: "Conflicting goal." }),
    "Mission store accepted conflicting identity replay",
  );
  const sourceEvents = await pool.query(
    "SELECT id FROM agent_world.world_events ORDER BY sequence, id",
  );
  if (sourceEvents.rows.length !== 2) {
    throw new Error("Mission collaboration verifier requires two canonical World events");
  }
  const decomposition = {
    schemaVersion: 1,
    id: "mission_decomposition_a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3",
    missionId: mission.id,
    projectId: ids.project,
    sourceEventId: sourceEvents.rows[0].id,
    rationale: "Separate implementation from independent review.",
    tasks: [
      {
        taskId: "task_a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
        key: "implement",
        title: "Implement the canonical protocol",
        assigneeAgentId: ids.agent,
        dependsOn: [],
      },
      {
        taskId: "task_a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2",
        key: "review",
        title: "Review the canonical protocol",
        assigneeAgentId: hub.secondaryAgent,
        dependsOn: ["implement"],
      },
    ],
    createdAt: "2026-08-13T09:18:00.000Z",
  };
  if (
    (await missionStore.createDecomposition(decomposition)).outcome !== "CREATED" ||
    (await missionStore.createDecomposition(decomposition)).outcome !== "REPLAY"
  ) {
    throw new Error("Mission decomposition idempotency drifted");
  }
  await expectRejected(
    missionStore.createDecomposition({ ...decomposition, rationale: "Conflicting rationale." }),
    "Mission decomposition accepted a conflicting identity replay",
  );
  await expectRejected(
    missionStore.createDecomposition({
      ...decomposition,
      id: "mission_decomposition_a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5",
      tasks: [{ ...decomposition.tasks[0], assigneeAgentId: legacy.agent }],
    }),
    "Mission decomposition accepted a cross-Project Agent",
  );
  const meeting = {
    schemaVersion: 1,
    id: "structured_meeting_a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4",
    missionId: mission.id,
    projectId: ids.project,
    topic: "Choose the verification order",
    positions: [
      { agentId: ids.agent, position: "Implement before review.", evidenceRefs: [] },
      {
        agentId: hub.secondaryAgent,
        position: "Require independent review before release.",
        evidenceRefs: [],
      },
    ],
    synthesis: "Implement first, then require independent review.",
    decision: "Release only after the independent review passes.",
    criterionAssessments: [
      {
        criterionId: mission.successCriteria[0].id,
        status: "PASSED",
        evidenceRefs: [sourceEvents.rows[0].id],
      },
    ],
    sourceEventIds: sourceEvents.rows.map(({ id }) => id).sort(),
    decidedAt: "2026-08-13T09:19:00.000Z",
  };
  if (
    (await missionStore.recordMeeting(meeting)).outcome !== "CREATED" ||
    (await missionStore.recordMeeting(meeting)).outcome !== "REPLAY"
  ) {
    throw new Error("Structured meeting idempotency drifted");
  }
  const collaborationEvidence = await pool.query(
    `SELECT event_type, sequence
       FROM agent_world.mission_collaboration_events
      WHERE mission_id = $1
      ORDER BY sequence, id`,
    [mission.id],
  );
  if (
    collaborationEvidence.rows.length !== 2 ||
    collaborationEvidence.rows[0]?.event_type !== "MISSION_DECOMPOSED" ||
    collaborationEvidence.rows[1]?.event_type !== "MEETING_DECIDED"
  ) {
    throw new Error("Mission collaboration events are not complete and replayable");
  }
  const criterionEvidence = await pool.query(
    `SELECT criterion.status, criterion.evidence_refs, assessment.meeting_id
       FROM agent_world.mission_success_criteria criterion
       JOIN agent_world.structured_meeting_criterion_assessments assessment
         ON assessment.criterion_id = criterion.id
      WHERE criterion.id = $1`,
    [mission.successCriteria[0].id],
  );
  if (
    criterionEvidence.rows[0]?.status !== "PASSED" ||
    criterionEvidence.rows[0]?.meeting_id !== meeting.id ||
    criterionEvidence.rows[0]?.evidence_refs?.[0] !== sourceEvents.rows[0].id
  ) {
    throw new Error("Structured meeting did not preserve success-criterion evidence");
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
  const assignedApproval = await pool.query(
    `SELECT state, requested_at, expires_at
       FROM agent_world.approvals
      WHERE task_id = $1`,
    [taskAssignment.taskId],
  );
  if (
    assignedApproval.rows.length !== 1 ||
    assignedApproval.rows[0]?.state !== "PENDING" ||
    Date.parse(assignedApproval.rows[0].expires_at) <=
      Date.parse(assignedApproval.rows[0].requested_at)
  ) {
    throw new Error("Task assignment did not create one expiring pending approval");
  }
  const assignmentReplay = await worldStore.assignTask({
    ...taskAssignment,
    createdAt: "2026-08-13T09:41:00.000Z",
  });
  if (assignmentReplay.outcome !== "REPLAY") {
    throw new Error("Task assignment did not return an idempotent replay");
  }
  const approvalResourceBroker = new PostgresResourceBrokerStore(pool);
  await approvalResourceBroker.recordObservation({
    routeId: ids.route,
    observedAt: "2026-08-13T09:44:00.000Z",
    expiresAt: "2026-08-13T09:50:00.000Z",
    isAvailable: true,
    quality: 0.9,
    remainingLimits: 0.9,
    cost: 0.8,
    speed: 0.8,
    load: 0.9,
    sourceKind: "HEALTHCHECK",
    sourceRef: "openclaw:isolated-ready",
  });
  const approvalEventIds = [
    "event_19191919-1919-1919-1919-191919191919",
    "event_20202020-2020-2020-2020-202020202020",
  ];
  const approvalStore = new PostgresApprovalRunStore(pool, {
    eventId: () => {
      const eventId = approvalEventIds.shift();
      if (!eventId) throw new Error("Isolated approval event identities were exhausted");
      return eventId;
    },
  });
  const approvalDecision = await approvalStore.decide({
    taskId: taskAssignment.taskId,
    approvalId: "approval_17171717-1717-1717-1717-171717171717",
    decision: "APPROVE",
    commandId: "approval-decision:approve:17171717-1717-1717-1717-171717171717",
    decidedAt: "2026-08-13T09:45:00.000Z",
  });
  if (
    approvalDecision.outcome !== "DECIDED" ||
    approvalDecision.approval.type !== "APPROVED" ||
    approvalDecision.run?.status !== "DISPATCH_PENDING"
  ) {
    throw new Error("Approval decision did not create one dispatch-pending canonical Run");
  }
  const approvalReplay = await approvalStore.decide({
    taskId: taskAssignment.taskId,
    approvalId: "approval_17171717-1717-1717-1717-171717171717",
    decision: "APPROVE",
    commandId: "approval-decision:approve:17171717-1717-1717-1717-171717171717",
    decidedAt: "2026-08-13T09:45:00.000Z",
  });
  if (approvalReplay.outcome !== "REPLAY" || approvalReplay.run?.id !== approvalDecision.run.id) {
    throw new Error("Approval decision replay created or selected a different Run");
  }
  const runEvidence = await pool.query(
    `SELECT status, attempt, dispatch_idempotency_key, external_run_id
       FROM agent_world.runs
      WHERE task_id = $1`,
    [taskAssignment.taskId],
  );
  if (
    runEvidence.rows.length !== 1 ||
    runEvidence.rows[0]?.status !== "DISPATCH_PENDING" ||
    runEvidence.rows[0]?.attempt !== 0 ||
    runEvidence.rows[0]?.dispatch_idempotency_key !== "run:17171717-1717-1717-1717-171717171717" ||
    runEvidence.rows[0]?.external_run_id !== null
  ) {
    throw new Error("Canonical Run persistence claimed unsupported dispatch evidence");
  }
  const runEventIds = [
    "event_21212121-2121-2121-2121-212121212121",
    "event_22222222-2222-2222-2222-222222222222",
  ];
  const runDispatchStore = new PostgresRunDispatchStore(pool, {
    eventId: () => {
      const eventId = runEventIds.shift();
      if (!eventId) throw new Error("Isolated Run event identities were exhausted");
      return eventId;
    },
  });
  const preparedDispatch = await runDispatchStore.prepare(approvalDecision.run.id);
  if (
    preparedDispatch.kind !== "READY" ||
    preparedDispatch.binding.externalAgentId !== "researcher" ||
    preparedDispatch.session.externalSessionRef !== "agent:researcher:protocol-review"
  ) {
    throw new Error("Run dispatch did not restore exact active runtime provenance");
  }
  const markedRunning = await runDispatchStore.markRunning({
    runId: approvalDecision.run.id,
    externalRunId: "isolated-openclaw-run-1",
    startedAt: "2026-08-13T09:45:01.000Z",
  });
  if (
    markedRunning.outcome !== "UPDATED" ||
    markedRunning.run.status !== "RUNNING" ||
    markedRunning.run.attempt !== 1
  ) {
    throw new Error("Accepted upstream Run receipt was not persisted exactly once");
  }
  const markedCompleted = await runDispatchStore.markTerminal({
    runId: approvalDecision.run.id,
    status: "COMPLETED",
    completedAt: "2026-08-13T09:46:00.000Z",
  });
  if (markedCompleted.outcome !== "UPDATED" || markedCompleted.run.status !== "COMPLETED") {
    throw new Error("Observed upstream terminal evidence did not complete the canonical Run");
  }
  const codex = {
    account: "account_a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
    modelRoute: "model_route_a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
    route: "route_a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2",
    binding: "binding_a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3",
    conversation: "conversation_a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4",
    session: "session_a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5",
    task: "task_a6a6a6a6-a6a6-a6a6-a6a6-a6a6a6a6a6a6",
    approval: "approval_a6a6a6a6-a6a6-a6a6-a6a6-a6a6a6a6a6a6",
    run: "run_a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7",
    execution: "codex_execution_a8a8a8a8-a8a8-a8a8-a8a8-a8a8a8a8a8a8",
    interruptedTask: "task_a9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9",
    interruptedApproval: "approval_a9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9",
    interruptedRun: "run_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    interruptedExecution: "codex_execution_abababab-abab-abab-abab-abababababab",
  };
  await pool.query(
    `INSERT INTO agent_world.accounts
       (id, provider_id, label, auth_mechanism, subscription, health)
     VALUES ($1, $2, 'Owner ChatGPT subscription', 'CHATGPT_INTERACTIVE', 'Plus', 'ACTIVE')`,
    [codex.account, hub.provider],
  );
  await pool.query(
    "INSERT INTO agent_world.account_surfaces (account_id, surface) VALUES ($1, 'CODEX')",
    [codex.account],
  );
  await pool.query(
    `INSERT INTO agent_world.model_routes
       (id, canonical_model_id, provider_id, account_id, surface, remote_model_id,
        availability, context_window_tokens)
     VALUES ($1, $2, $3, $4, 'CODEX', 'gpt-5.6-codex', 'AVAILABLE', 200000)`,
    [codex.modelRoute, hub.model, hub.provider, codex.account],
  );
  const codexRouteReceipt = await new PostgresHubCommandStore(pool).execute(
    HubCommandRequestSchema.parse({
      schemaVersion: 1,
      commandId: "hub_command_a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      kind: "CODEX_ROUTE_CREATE",
      routeId: codex.route,
      accountId: codex.account,
      modelRouteId: codex.modelRoute,
      label: "Official Codex SDK",
      reasoningEffort: "HIGH",
    }),
  );
  if (
    codexRouteReceipt.outcome !== "CREATED" ||
    codexRouteReceipt.resource.kind !== "EXECUTION_ROUTE" ||
    codexRouteReceipt.resource.id !== codex.route
  ) {
    throw new Error("Codex route command did not create an exact canonical route");
  }
  await expectRejected(
    pool.query(
      `UPDATE agent_world.codex_execution_policies
          SET network_access = true
        WHERE route_id = $1`,
      [codex.route],
    ),
    "Codex route policy allowed network access to be broadened",
  );
  await pool.query(
    `INSERT INTO agent_world.runtime_bindings
       (id, agent_id, route_id, adapter_kind, external_agent_id)
     VALUES ($1, $2, $3, 'CODEX', 'codex:researcher')`,
    [codex.binding, ids.agent, codex.route],
  );
  await pool.query(
    `INSERT INTO agent_world.conversations
       (id, agent_id, project_id, title, created_at)
     VALUES ($1, $2, $3, 'Codex repository verification', $4)`,
    [codex.conversation, ids.agent, ids.project, "2026-08-13T11:50:00.000Z"],
  );
  await pool.query(
    `INSERT INTO agent_world.conversation_sessions
       (id, conversation_id, agent_id, binding_id, adapter_kind,
        external_session_ref, started_at)
     VALUES ($1, $2, $3, $4, 'CODEX', 'codex-thread-isolated-1', $5)`,
    [codex.session, codex.conversation, ids.agent, codex.binding, "2026-08-13T11:51:00.000Z"],
  );
  await pool.query(
    `INSERT INTO agent_world.tasks
       (id, conversation_id, project_id, assignee_agent_id, title, description,
        approval_requirement, idempotency_key, created_at)
     VALUES
       ($1, $3, $4, $5, 'Verify Codex lifecycle', 'Persist normalized execution evidence.',
        'REQUIRED', 'task:codex-lifecycle', $6),
       ($2, $3, $4, $5, 'Verify interrupted Codex worker', 'Fail closed without an implicit rerun.',
        'REQUIRED', 'task:codex-interrupted', $6)`,
    [
      codex.task,
      codex.interruptedTask,
      codex.conversation,
      ids.project,
      ids.agent,
      "2026-08-13T11:52:00.000Z",
    ],
  );
  await pool.query(
    `INSERT INTO agent_world.approvals
       (id, task_id, state, requested_at, expires_at, decided_at, decision_command_id)
     VALUES
       ($1, $2, 'APPROVED', $5, $6, $7, 'approve:codex-lifecycle'),
       ($3, $4, 'APPROVED', $5, $6, $7, 'approve:codex-interrupted')`,
    [
      codex.approval,
      codex.task,
      codex.interruptedApproval,
      codex.interruptedTask,
      "2026-08-13T11:52:00.000Z",
      "2026-08-14T11:52:00.000Z",
      "2026-08-13T11:53:00.000Z",
    ],
  );
  await pool.query(
    `INSERT INTO agent_world.runs
       (id, task_id, conversation_id, agent_id, approval_id, adapter_kind,
        binding_id, session_id, status, dispatch_idempotency_key, created_at)
     VALUES
       ($1, $2, $5, $6, $7, 'CODEX', $9, $10, 'DISPATCH_PENDING', 'run:codex-lifecycle', $11),
       ($3, $4, $5, $6, $8, 'CODEX', $9, $10, 'DISPATCH_PENDING', 'run:codex-interrupted', $11)`,
    [
      codex.run,
      codex.task,
      codex.interruptedRun,
      codex.interruptedTask,
      codex.conversation,
      ids.agent,
      codex.approval,
      codex.interruptedApproval,
      codex.binding,
      codex.session,
      "2026-08-13T11:54:00.000Z",
    ],
  );
  await new PostgresCodexWorkerReadinessStore(pool).report({
    workerId: "codex-worker-isolated",
    accountId: codex.account,
    authentication: "CHATGPT",
    checkedAt: new Date().toISOString(),
  });
  const codexResolution = await new PostgresCodexBindingResolver(pool).resolve({
    runId: codex.run,
    bindingId: codex.binding,
    agentId: ids.agent,
    externalAgentId: "codex:researcher",
  });
  if (
    codexResolution.routeId !== codex.route ||
    codexResolution.accountId !== codex.account ||
    codexResolution.policy.networkAccess !== false ||
    codexResolution.policy.workingDirectory !== "/workspaces/project"
  ) {
    throw new Error("Codex binding resolver did not restore exact safe route provenance");
  }
  await pool.query(
    "UPDATE agent_world.codex_worker_readiness SET checked_at = statement_timestamp() - interval '2 minutes', authenticated_at = statement_timestamp() - interval '2 minutes', updated_at = statement_timestamp() - interval '2 minutes' WHERE account_id = $1",
    [codex.account],
  );
  await expectRejected(
    new PostgresCodexBindingResolver(pool).resolve({
      runId: codex.run,
      bindingId: codex.binding,
      agentId: ids.agent,
      externalAgentId: "codex:researcher",
    }),
    "Codex binding resolver accepted a stale worker heartbeat",
  );
  await pool.query(
    "UPDATE agent_world.codex_worker_readiness SET checked_at = statement_timestamp(), authenticated_at = statement_timestamp(), updated_at = statement_timestamp() WHERE account_id = $1",
    [codex.account],
  );
  const codexProvenance = await new PostgresRunProvenanceReader(pool).read(codex.run);
  if (
    codexProvenance.routeId !== codex.route ||
    codexProvenance.accountId !== codex.account ||
    codexProvenance.modelRouteId !== codex.modelRoute ||
    codexProvenance.remoteModelId !== "gpt-5.6-codex" ||
    codexProvenance.mode !== "CODEX" ||
    codexProvenance.adapterKind !== "CODEX"
  ) {
    throw new Error("Run provenance projection did not preserve exact Codex identities");
  }
  await pool.query("UPDATE agent_world.accounts SET health = 'UNCONFIGURED' WHERE id = $1", [
    codex.account,
  ]);
  await expectRejected(
    new PostgresCodexBindingResolver(pool).resolve({
      runId: codex.run,
      bindingId: codex.binding,
      agentId: ids.agent,
      externalAgentId: "codex:researcher",
    }),
    "Codex binding resolver accepted an unavailable ChatGPT account",
  );
  await pool.query("UPDATE agent_world.accounts SET health = 'ACTIVE' WHERE id = $1", [
    codex.account,
  ]);
  let codexExecutionId = codex.execution;
  let codexNow = "2026-08-13T12:00:00.000Z";
  const codexStore = new PostgresCodexExecutionStore(pool, {
    executionId: () => codexExecutionId,
    now: () => codexNow,
  });
  const codexContextPackProvider = new PostgresRunContextPackProvider(pool, {
    packId: () => "context_pack_a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7",
    now: () => "2026-08-13T11:59:00.000Z",
    tokenBudget: 2_000,
  });
  const codexContextPack = await codexContextPackProvider.prepare(codex.run);
  const codexContextPackReplay = await new PostgresRunContextPackProvider(pool, {
    packId: () => {
      throw new Error("Persisted ContextPack must be recovered without recompilation");
    },
  }).prepare(codex.run);
  if (
    codexContextPack.routeId !== codex.route ||
    codexContextPack.runId !== codex.run ||
    codexContextPack.contentHash !== codexContextPackReplay.contentHash ||
    codexContextPack.rendered !== codexContextPackReplay.rendered ||
    !codexContextPack.evidence.some(
      (evidence) => evidence.contextItemId === chunkReceipt.contextItemId,
    ) ||
    !codexContextPack.rendered.includes("PostgreSQL is canonical.")
  ) {
    throw new Error("Codex ContextPack did not preserve exact Run and Route provenance");
  }
  const codexRequest = {
    schemaVersion: 1,
    runId: codex.run,
    taskId: codex.task,
    agentId: ids.agent,
    bindingId: codex.binding,
    routeId: codex.route,
    accountId: codex.account,
    sessionId: codex.session,
    codexThreadId: "codex-thread-isolated-1",
    idempotencyKey: "codex:isolated-lifecycle",
    prompt: codexContextPack.rendered,
    policy: {
      workingDirectory: "C:/isolated/agent-world",
      sandbox: "WORKSPACE_WRITE",
      approvalPolicy: "ON_REQUEST",
      networkAccess: false,
      timeoutMs: 60_000,
      model: "gpt-5.6-codex",
      reasoningEffort: "HIGH",
    },
  };
  const codexReceipt = await codexStore.dispatch(codexRequest);
  const codexReplay = await codexStore.dispatch(codexRequest);
  if (
    codexReceipt.externalRunId !== codex.execution ||
    JSON.stringify(codexReplay) !== JSON.stringify(codexReceipt)
  ) {
    throw new Error("Codex dispatch did not return the exact durable replay");
  }
  await expectRejected(
    codexStore.dispatch({ ...codexRequest, prompt: "Changed immutable prompt." }),
    "Codex dispatch accepted changed input under an existing idempotency key",
  );
  codexNow = "2026-08-13T12:00:01.000Z";
  const claimedCodex = await codexStore.claim("isolated-codex-worker", 60_000);
  if (claimedCodex?.externalRunId !== codex.execution || claimedCodex.attempt !== 1) {
    throw new Error("Codex worker did not claim exactly one queued execution");
  }
  codexNow = "2026-08-13T12:00:02.000Z";
  const renewedCodexLease = await codexStore.renewLease(
    codex.execution,
    "isolated-codex-worker",
    60_000,
  );
  if (renewedCodexLease.leaseExpiresAt !== "2026-08-13T12:01:02.000Z") {
    throw new Error("Codex worker lease did not renew for the active worker");
  }
  const codexEvents = [
    {
      schemaVersion: 1,
      sequence: 1,
      eventType: "RUN_STARTED",
      occurredAt: codexNow,
      threadId: codexRequest.codexThreadId,
    },
    {
      schemaVersion: 1,
      sequence: 2,
      eventType: "ITEM_COMPLETED",
      occurredAt: "2026-08-13T12:00:03.000Z",
      itemId: "item-isolated-1",
      itemType: "COMMAND",
      summary: "Verified repository contracts.",
    },
    {
      schemaVersion: 1,
      sequence: 3,
      eventType: "FINAL_OUTPUT",
      occurredAt: "2026-08-13T12:00:04.000Z",
      content: JSON.stringify({
        schemaVersion: 1,
        fullOutput: "All selected contracts passed.",
        summary: "Selected contracts passed.",
        findings: ["ContextPack provenance is exact."],
        decisions: [],
        actions: ["Ran isolated verification."],
        artifacts: [],
        openQuestions: [],
        nextActions: [],
        memoryCandidates: [],
        confidence: 1,
      }),
    },
    {
      schemaVersion: 1,
      sequence: 4,
      eventType: "USAGE_RECORDED",
      occurredAt: "2026-08-13T12:00:05.000Z",
      usage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 30 },
    },
    {
      schemaVersion: 1,
      sequence: 5,
      eventType: "RUN_COMPLETED",
      occurredAt: "2026-08-13T12:00:06.000Z",
    },
  ];
  for (const event of codexEvents) {
    codexNow = event.occurredAt;
    await codexStore.appendEvent(codex.execution, "isolated-codex-worker", event);
  }
  const eventReplay = await codexStore.appendEvent(
    codex.execution,
    "isolated-codex-worker",
    codexEvents[1],
  );
  if (eventReplay.outcome !== "REPLAY") throw new Error("Codex event replay was not idempotent");
  await expectRejected(
    codexStore.appendEvent(codex.execution, "isolated-codex-worker", {
      ...codexEvents[1],
      summary: "Conflicting summary.",
    }),
    "Codex event sequence accepted a conflicting fingerprint",
  );
  const codexObservation = await codexStore.observe(codex.execution, 0);
  const codexEvidence = await pool.query(
    `SELECT job.status, job.attempt, job.final_output, job.structured_result,
            job.result_parse_status, job.input_tokens, job.prompt,
            job.cached_input_tokens, job.output_tokens,
            pack.content_sha256 AS context_pack_sha256,
            count(event.*)::integer AS event_count,
            max(event.summary) FILTER (WHERE event.event_type = 'ITEM_COMPLETED') AS item_summary
       FROM agent_world.codex_execution_jobs job
       JOIN agent_world.context_packs pack ON pack.run_id = job.run_id
       JOIN agent_world.codex_execution_events event ON event.execution_id = job.id
      WHERE job.id = $1
      GROUP BY job.id, pack.id`,
    [codex.execution],
  );
  if (
    codexObservation.status !== "COMPLETED" ||
    codexEvidence.rows[0]?.status !== "COMPLETED" ||
    codexEvidence.rows[0]?.attempt !== 1 ||
    codexEvidence.rows[0]?.result_parse_status !== "VALIDATED" ||
    codexEvidence.rows[0]?.structured_result?.summary !== "Selected contracts passed." ||
    JSON.parse(codexEvidence.rows[0]?.final_output ?? "null")?.fullOutput !==
      "All selected contracts passed." ||
    codexEvidence.rows[0]?.prompt !== codexContextPack.rendered ||
    codexEvidence.rows[0]?.context_pack_sha256 !== codexContextPack.contentHash ||
    codexEvidence.rows[0]?.input_tokens !== "120" ||
    codexEvidence.rows[0]?.cached_input_tokens !== "20" ||
    codexEvidence.rows[0]?.output_tokens !== "30" ||
    codexEvidence.rows[0]?.event_count !== 5 ||
    codexEvidence.rows[0]?.item_summary !== "Verified repository contracts."
  ) {
    throw new Error(
      "Codex lifecycle did not preserve normalized output, usage, and event provenance",
    );
  }
  codexExecutionId = codex.interruptedExecution;
  codexNow = "2026-08-13T12:02:00.000Z";
  const interruptedRequest = {
    ...codexRequest,
    runId: codex.interruptedRun,
    taskId: codex.interruptedTask,
    idempotencyKey: "codex:isolated-interrupted",
  };
  await codexStore.dispatch(interruptedRequest);
  codexNow = "2026-08-13T12:02:01.000Z";
  await codexStore.claim("isolated-codex-worker", 10_000);
  codexNow = "2026-08-13T12:02:02.000Z";
  await codexStore.appendEvent(codex.interruptedExecution, "isolated-codex-worker", {
    schemaVersion: 1,
    sequence: 1,
    eventType: "RUN_STARTED",
    occurredAt: codexNow,
    threadId: codexRequest.codexThreadId,
  });
  codexNow = "2026-08-13T12:02:12.000Z";
  const recovery = await codexStore.recoverExpired();
  const interruptedObservation = await codexStore.observe(codex.interruptedExecution, 0);
  if (
    recovery.interrupted !== 1 ||
    interruptedObservation.status !== "FAILED" ||
    interruptedObservation.failureCode !== "WORKER_INTERRUPTED" ||
    (await codexStore.claim("isolated-codex-worker", 10_000)) !== undefined
  ) {
    throw new Error("Expired Codex lease was rerun or did not fail closed as interrupted");
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
    taskWorld.cursor.lastSequence !== 8 ||
    taskWorld.tasks[0]?.approval !== "APPROVED" ||
    taskWorld.agents[0]?.status !== "IDLE" ||
    taskWorld.agents[0]?.currentTask?.taskId !== taskAssignment.taskId
  ) {
    throw new Error("Restarted World projection did not restore the canonical Task assignment");
  }
  const preferenceStore = new PostgresExecutionPreferenceStore(pool);
  await preferenceStore.writeLayer(
    ExecutionPreferenceLayerSchema.parse({
      schemaVersion: 1,
      scope: { kind: "PROJECT", projectId: ids.project },
      overrides: { context: "LEAN", budget: "ECONOMY" },
    }),
    "2026-08-13T09:42:00.000Z",
  );
  await preferenceStore.writeLayer(
    ExecutionPreferenceLayerSchema.parse({
      schemaVersion: 1,
      scope: { kind: "AGENT", agentId: ids.agent },
      overrides: { mode: "CODEX" },
    }),
    "2026-08-13T09:42:01.000Z",
  );
  await preferenceStore.writeLayer(
    ExecutionPreferenceLayerSchema.parse({
      schemaVersion: 1,
      scope: { kind: "TASK", taskId: taskAssignment.taskId },
      overrides: { budget: "QUALITY" },
    }),
    "2026-08-13T09:42:02.000Z",
  );
  const resolvedPreferences = await preferenceStore.resolve({
    projectId: ids.project,
    agentId: ids.agent,
    taskId: taskAssignment.taskId,
  });
  if (
    resolvedPreferences.mode.value !== "CODEX" ||
    resolvedPreferences.mode.source.kind !== "AGENT" ||
    resolvedPreferences.context.value !== "LEAN" ||
    resolvedPreferences.context.source.kind !== "PROJECT" ||
    resolvedPreferences.budget.value !== "QUALITY" ||
    resolvedPreferences.budget.source.kind !== "TASK"
  ) {
    throw new Error("Sparse execution preferences did not preserve winning scope provenance");
  }
  await preferenceStore.writeLayer(
    ExecutionPreferenceLayerSchema.parse({
      schemaVersion: 1,
      scope: { kind: "TASK", taskId: taskAssignment.taskId },
      overrides: {},
    }),
    "2026-08-13T09:42:03.000Z",
  );
  const resetPreferenceModel = await preferenceStore.read({
    projectId: ids.project,
    agentId: ids.agent,
    taskId: taskAssignment.taskId,
  });
  const resetPreferences = resetPreferenceModel.resolved;
  if (
    resetPreferences.budget.value !== "ECONOMY" ||
    resetPreferences.budget.source.kind !== "PROJECT" ||
    Object.keys(resetPreferenceModel.local.overrides).length !== 0
  ) {
    throw new Error("Execution preference reset did not reveal the inherited Project value");
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
  const indexedConversationIds = agentConversationIndex?.conversations.map(
    ({ conversationId }) => conversationId,
  );
  if (
    agentConversationIndex?.conversations.length !== 2 ||
    !indexedConversationIds?.includes(ids.conversation) ||
    !indexedConversationIds.includes(codex.conversation)
  ) {
    throw new Error("PostgreSQL reader did not list both canonical Agent Conversations");
  }
  for (const forbidden of [
    ids.session,
    ids.binding,
    "gateway-message-private-locator",
    codex.session,
    codex.binding,
    "codex-thread-isolated-1",
  ]) {
    if (serializedIndex.includes(forbidden)) {
      throw new Error("PostgreSQL Agent index leaked a runtime locator");
    }
  }

  const nativeChat = {
    route: "route_c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1",
    conversation: "conversation_c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
    task: "task_c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5",
    approval: "approval_c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5",
    run: "run_c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5",
    dispatch: "chat_dispatch_c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5",
  };
  await pool.query(
    "INSERT INTO agent_world.account_surfaces (account_id, surface) VALUES ($1, 'CHAT') ON CONFLICT DO NOTHING",
    [codex.account],
  );
  await pool.query(
    `INSERT INTO agent_world.execution_routes
       (id, label, mode, adapter_kind, account_id)
     VALUES ($1, 'Native Plus Chat MCP', 'CHAT', 'NATIVE_CHATGPT', $2)`,
    [nativeChat.route, codex.account],
  );
  await pool.query(
    `INSERT INTO agent_world.conversations
       (id, agent_id, project_id, title, created_at)
     VALUES ($1, $2, $3, 'Native Plus Chat verification', $4)`,
    [nativeChat.conversation, ids.agent, ids.project, "2026-08-13T13:00:00.000Z"],
  );
  await pool.query(
    `INSERT INTO agent_world.tasks
       (id, conversation_id, project_id, assignee_agent_id, title, description,
        approval_requirement, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, 'Verify Native Chat commit',
             'Commit through the canonical Control event stream.', 'REQUIRED',
             'task:native-chat-control', $5)`,
    [nativeChat.task, nativeChat.conversation, ids.project, ids.agent, "2026-08-13T13:00:02.000Z"],
  );
  await preferenceStore.writeLayer(
    ExecutionPreferenceLayerSchema.parse({
      schemaVersion: 1,
      scope: { kind: "TASK", taskId: nativeChat.task },
      overrides: { mode: "CHAT" },
    }),
    "2026-08-13T13:00:02.050Z",
  );
  const resourceBroker = new PostgresResourceBrokerStore(pool);
  await resourceBroker.recordObservation({
    routeId: nativeChat.route,
    observedAt: "2026-08-13T13:00:02.100Z",
    expiresAt: "2026-08-13T13:05:02.100Z",
    isAvailable: true,
    quality: 0.95,
    remainingLimits: 0.8,
    cost: 1,
    speed: 0.7,
    load: 0.9,
    sourceKind: "AUTH",
    sourceRef: "oauth-grant:native-chat-isolated",
  });
  const brokerRequest = {
    decisionId: "broker_decision_c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0",
    taskId: nativeChat.task,
    policy: {
      version: "resource-broker-v1",
      weights: { quality: 0.4, remainingLimits: 0.3, cost: 0.1, speed: 0.1, load: 0.1 },
    },
    decidedAt: "2026-08-13T13:00:03.000Z",
    allowedModes: ["CHAT"],
  };
  const brokerDecision = await resourceBroker.decide(brokerRequest);
  const brokerReplay = await resourceBroker.decide(brokerRequest);
  if (
    brokerDecision.selected?.routeId !== nativeChat.route ||
    brokerDecision.selected.accountId !== codex.account ||
    brokerReplay.selected?.routeId !== nativeChat.route
  ) {
    throw new Error("Resource Broker did not persist and replay the selected Native Chat route");
  }
  await expectRejected(
    resourceBroker.decide({ ...brokerRequest, decidedAt: "2026-08-13T13:00:03.001Z" }),
    "Resource Broker accepted conflicting decision idempotency input",
  );
  const brokerEvidence = await pool.query(
    `SELECT decision.decision_sha256, decision.selected_route_id,
            decision.selected_account_id, decision.selected_score,
            decision.fallback_reason, event.sequence AS event_sequence,
            event.decision_sha256 AS event_decision_sha256
       FROM agent_world.resource_broker_decisions decision
       JOIN agent_world.resource_broker_events event ON event.decision_id = decision.id
      WHERE decision.id = $1`,
    [brokerRequest.decisionId],
  );
  if (
    brokerEvidence.rows.length !== 1 ||
    !/^[a-f0-9]{64}$/.test(brokerEvidence.rows[0]?.decision_sha256 ?? "") ||
    brokerEvidence.rows[0]?.selected_route_id !== nativeChat.route ||
    brokerEvidence.rows[0]?.selected_account_id !== codex.account ||
    brokerEvidence.rows[0]?.fallback_reason !== null ||
    brokerEvidence.rows[0]?.event_sequence < 1 ||
    brokerEvidence.rows[0]?.event_decision_sha256 !== brokerEvidence.rows[0]?.decision_sha256
  ) {
    throw new Error("Resource Broker decision evidence was not canonical and attributable");
  }
  await pool.query(
    `INSERT INTO agent_world.approvals
       (id, task_id, state, requested_at, expires_at, decided_at, decision_command_id)
     VALUES ($1, $2, 'PENDING', $3, $4, NULL, NULL)`,
    [nativeChat.approval, nativeChat.task, "2026-08-13T13:00:02.000Z", "2026-08-14T13:00:02.000Z"],
  );
  const nativeApprovalEventIds = [
    "event_cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb",
    "event_cccccccc-cccc-cccc-cccc-cccccccccccc",
  ];
  const nativeApprovalStore = new PostgresApprovalRunStore(pool, {
    eventId: () => {
      const eventId = nativeApprovalEventIds.shift();
      if (!eventId) throw new Error("Native Chat approval event identities were exhausted");
      return eventId;
    },
  });
  const nativeApprovalDecision = await nativeApprovalStore.decide({
    taskId: nativeChat.task,
    approvalId: nativeChat.approval,
    decision: "APPROVE",
    commandId: "approve:native-chat-control",
    decidedAt: "2026-08-13T13:00:04.000Z",
  });
  if (
    nativeApprovalDecision.run?.adapterKind !== "NATIVE_CHATGPT" ||
    nativeApprovalDecision.run.routeId !== nativeChat.route ||
    nativeApprovalDecision.run.accountId !== codex.account
  ) {
    throw new Error("Approval path did not atomically select the Native Chat route");
  }
  const nativeRunProvenance = await new PostgresRunProvenanceReader(pool).read(nativeChat.run);
  if (
    nativeRunProvenance.routeId !== nativeChat.route ||
    nativeRunProvenance.accountId !== codex.account ||
    nativeRunProvenance.mode !== "CHAT" ||
    nativeRunProvenance.adapterKind !== "NATIVE_CHATGPT"
  ) {
    throw new Error("Native Chat Run provenance was not readable without a runtime binding");
  }
  const nativeChatProvenance = await pool.query(
    `SELECT r.binding_id, r.session_id, r.route_id, r.account_id, r.execution_mode,
            (SELECT count(*)::integer
               FROM agent_world.runtime_bindings
              WHERE adapter_kind = 'NATIVE_CHATGPT') AS synthetic_bindings,
            (SELECT count(*)::integer
               FROM agent_world.conversation_sessions
              WHERE adapter_kind = 'NATIVE_CHATGPT') AS synthetic_sessions
       FROM agent_world.runs r
      WHERE r.id = $1`,
    [nativeChat.run],
  );
  if (
    nativeChatProvenance.rows.length !== 1 ||
    nativeChatProvenance.rows[0]?.binding_id !== null ||
    nativeChatProvenance.rows[0]?.session_id !== null ||
    nativeChatProvenance.rows[0]?.route_id !== nativeChat.route ||
    nativeChatProvenance.rows[0]?.account_id !== codex.account ||
    nativeChatProvenance.rows[0]?.execution_mode !== "CHAT" ||
    nativeChatProvenance.rows[0]?.synthetic_bindings !== 0 ||
    nativeChatProvenance.rows[0]?.synthetic_sessions !== 0
  ) {
    throw new Error(
      `Native Chat Run provenance created a synthetic runtime binding/session: ${JSON.stringify(nativeChatProvenance.rows[0])}`,
    );
  }
  const nativeChatLauncher = new PostgresNativeChatLaunchStore(pool);
  const configuredNativeChatProfile = await nativeChatLauncher.configureProfile({
    accountId: codex.account,
    profileRef: "plus-isolated",
    launchUrl: "https://chatgpt.com/g/ai-world-isolated",
    isEnabled: true,
    updatedAt: "2026-08-13T13:00:04.100Z",
  });
  const listedNativeChatProfiles = await nativeChatLauncher.listProfiles();
  if (
    configuredNativeChatProfile.accountId !== codex.account ||
    listedNativeChatProfiles.profiles.length !== 1 ||
    listedNativeChatProfiles.profiles[0]?.launchUrl !== "https://chatgpt.com/g/ai-world-isolated"
  ) {
    throw new Error("Native Chat profile owner configuration was not persisted safely");
  }
  await assert.rejects(
    nativeChatLauncher.configureProfile({
      accountId: ids.account,
      profileRef: "invalid-non-chat-account",
      launchUrl: "https://chatgpt.com/g/ai-world-isolated",
      isEnabled: true,
      updatedAt: "2026-08-13T13:00:04.200Z",
    }),
    (error) => error?.code === "INVALID_ACCOUNT",
  );
  const launcherId = "launcher_cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd";
  const launchClaim = await nativeChatLauncher.claimNext({
    launcherId,
    claimedAt: "2026-08-13T13:00:04.200Z",
    leaseExpiresAt: "2026-08-13T13:02:04.200Z",
  });
  if (
    launchClaim?.dispatchId !== nativeChat.dispatch ||
    launchClaim.message.runId !== nativeChat.run ||
    launchClaim.profileRef !== "plus-isolated" ||
    launchClaim.launchUrl !== "https://chatgpt.com/g/ai-world-isolated" ||
    Object.keys(launchClaim.message).length !== 1
  ) {
    throw new Error("Native Chat launcher claim leaked context or selected the wrong Account");
  }
  const submissionReceipt = await nativeChatLauncher.markSubmitted({
    dispatchId: nativeChat.dispatch,
    launcherId,
    attempt: launchClaim.attempt,
    submittedAt: "2026-08-13T13:00:05.000Z",
  });
  if (
    submissionReceipt.runId !== nativeChat.run ||
    submissionReceipt.accountId !== codex.account ||
    submissionReceipt.profileRef !== "plus-isolated" ||
    !/^[a-f0-9]{64}$/.test(submissionReceipt.receiptSha256)
  ) {
    throw new Error("Native Chat launcher submission receipt lost canonical provenance");
  }
  await expectRejected(
    nativeChatLauncher.markSubmitted({
      dispatchId: nativeChat.dispatch,
      launcherId,
      attempt: launchClaim.attempt,
      submittedAt: "2026-08-13T13:00:05.000Z",
    }),
    "Native Chat launcher accepted a duplicate submission receipt",
  );
  const nativeChatEventIds = [
    "event_c8c8c8c8-c8c8-c8c8-c8c8-c8c8c8c8c8c8",
    "event_c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9",
  ];
  let nativeChatNow = 0;
  const nativeChatStore = new PostgresNativeChatControlStore(pool, {
    eventId: () => {
      const eventId = nativeChatEventIds.shift();
      if (!eventId) throw new Error("Isolated Native Chat event identities were exhausted");
      return eventId;
    },
    contextItemId: () => "context_item_c8c8c8c8-c8c8-c8c8-c8c8-c8c8c8c8c8c8",
    memoryProposalId: () => "memory_proposal_c8c8c8c8-c8c8-c8c8-c8c8-c8c8c8c8c8c8",
    memoryEventId: () => "event_cacacaca-caca-caca-caca-cacacacacaca",
    now: () => new Date(`2026-08-13T13:01:0${nativeChatNow++}.000Z`),
  });
  const beginEvent = {
    schemaVersion: 1,
    runId: nativeChat.run,
    sequence: 1,
    idempotencyKey: "native-chat:begin:isolated",
    eventType: "BEGIN_RUN",
    payload: {},
  };
  if ((await nativeChatStore.append(codex.account, beginEvent)).outcome !== "APPENDED") {
    throw new Error("Native Chat begin_run was not appended");
  }
  const findingEvent = {
    schemaVersion: 1,
    runId: nativeChat.run,
    sequence: 2,
    idempotencyKey: "native-chat:finding:isolated",
    eventType: "FINDING",
    payload: { statement: "PostgreSQL is canonical.", confidence: 1 },
  };
  await nativeChatStore.append(codex.account, findingEvent);
  await pool.query(
    `INSERT INTO agent_world.artifacts
       (id, project_id, run_id, label, content_sha256, media_type, storage_ref, byte_size, created_at)
     VALUES ($1, $2, $3, 'Native Chat verifier', $4, 'application/json',
             'artifacts/native-chat-verifier.json', 128, $5)`,
    [
      "artifact_c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6",
      ids.project,
      nativeChat.run,
      "6".repeat(64),
      "2026-08-13T13:01:02.100Z",
    ],
  );
  await pool.query(
    `INSERT INTO agent_world.context_items
       (id, project_id, kind, temperature, content, summary, content_sha256,
        estimated_tokens, importance, provenance_kind, run_id, created_at)
     VALUES ($1, $2, 'MEMORY', 'WARM', 'Native Chat commits through canonical events.',
             'Canonical Native Chat memory.', $3, 9, 0.95, 'RUN', $4, $5)`,
    [
      "context_item_c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6",
      ids.project,
      "7".repeat(64),
      nativeChat.run,
      "2026-08-13T13:01:02.200Z",
    ],
  );
  const contextPackStore = new PostgresContextPackStore(pool);
  const compiledContextPack = compileContextPack(
    {
      schemaVersion: 1,
      packId: "context_pack_c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6",
      runId: nativeChat.run,
      task: {
        schemaVersion: 1,
        id: nativeChat.task,
        projectId: ids.project,
        assigneeAgentId: ids.agent,
        title: "Verify Native Chat commit",
        description: "Commit through the canonical Control event stream.",
        approvalRequirement: "REQUIRED",
        idempotencyKey: "task:native-chat-control",
        createdAt: "2026-08-13T13:00:02.000Z",
      },
      agent: worldAgent,
      project: {
        id: ids.project,
        name: "Protocol project",
        state: "Native Chat verification is active.",
      },
      route: {
        schemaVersion: 1,
        id: nativeChat.route,
        label: "Native Plus Chat MCP",
        mode: "CHAT",
        adapterKind: "NATIVE_CHATGPT",
        accountId: codex.account,
        isEnabled: true,
      },
      tokenBudget: 1_000,
      expectedOutput: "A structured canonical result.",
      handoffContract: "Commit exactly one terminal result.",
      availableTools: ["get_run_resources", "commit_result"],
    },
    [
      {
        item: {
          schemaVersion: 1,
          id: "context_item_c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6",
          projectId: ids.project,
          kind: "MEMORY",
          temperature: "WARM",
          content: "Native Chat commits through canonical events.",
          summary: "Canonical Native Chat memory.",
          contentHash: "7".repeat(64),
          estimatedTokens: 9,
          importance: 0.95,
          provenance: { kind: "RUN", runId: nativeChat.run },
          createdAt: "2026-08-13T13:01:02.200Z",
        },
        relevance: 1,
      },
    ],
    "2026-08-13T13:01:02.300Z",
  );
  const persistedContextPack = await contextPackStore.persist(compiledContextPack);
  const replayedContextPack = await contextPackStore.persist(compiledContextPack);
  const recoveredContextPack = await new PostgresContextPackStore(pool).readByRun(nativeChat.run);
  if (
    persistedContextPack.outcome !== "CREATED" ||
    replayedContextPack.outcome !== "REPLAY" ||
    JSON.stringify(recoveredContextPack) !== JSON.stringify(compiledContextPack)
  ) {
    throw new Error("ContextPack was not persisted, replayed, and recovered exactly");
  }
  const nativeChatResourceReader = new PostgresNativeChatResourceReader(pool, {
    pullId: () => "resource_pull_c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7",
    now: () => new Date("2026-08-13T13:01:03.000Z"),
  });
  const nativeChatPull = await nativeChatResourceReader.pull(codex.account, {
    schemaVersion: 1,
    runId: nativeChat.run,
    resources: ["TASK", "PROJECT_STATE", "ACTION_HISTORY", "MEMORY", "RAG", "SKILLS", "ARTIFACTS"],
    maxItems: 10,
    maxTokens: 2_000,
  });
  if (
    nativeChatPull.items.length !== 9 ||
    nativeChatPull.omissions.length !== 0 ||
    new Set(nativeChatPull.items.map((item) => item.resource)).size !== 7 ||
    !nativeChatPull.items.some(
      (item) => item.resource === "MEMORY" && item.provenance[0]?.entityId === memoryIds.context,
    )
  ) {
    throw new Error(
      `Native Chat lazy pull did not return exact bounded canonical resources: ${JSON.stringify(nativeChatPull)}`,
    );
  }
  await expectRejected(
    nativeChatResourceReader.pull(legacy.account, {
      schemaVersion: 1,
      runId: nativeChat.run,
      resources: ["TASK"],
      maxItems: 1,
      maxTokens: 500,
    }),
    "Native Chat lazy pull crossed the canonical Account boundary",
  );
  const commitEvent = {
    schemaVersion: 1,
    runId: nativeChat.run,
    sequence: 3,
    idempotencyKey: "native-chat:commit:isolated",
    eventType: "COMMIT_RESULT",
    payload: {
      result: {
        schemaVersion: 1,
        fullOutput: "Native Chat result committed without DOM capture.",
        summary: "Canonical commit succeeded.",
        findings: ["PostgreSQL is canonical."],
        decisions: [],
        actions: [],
        artifacts: [],
        openQuestions: [],
        nextActions: [],
        memoryCandidates: [
          { statement: "Native Chat commits through Control API.", confidence: 1, importance: 0.9 },
        ],
        confidence: 1,
      },
    },
  };
  if ((await nativeChatStore.append(codex.account, commitEvent)).outcome !== "APPENDED") {
    throw new Error("Native Chat commit_result was not appended");
  }
  if ((await nativeChatStore.append(codex.account, commitEvent)).outcome !== "REPLAY") {
    throw new Error("Native Chat exact commit_result did not replay");
  }
  await expectRejected(
    nativeChatStore.append(codex.account, {
      ...findingEvent,
      payload: { statement: "Conflicting replay.", confidence: 0 },
    }),
    "Native Chat accepted a conflicting idempotency replay",
  );
  const nativeChatEvidence = await pool.query(
    `SELECT r.status, d.state, d.last_sequence,
            (SELECT count(*)::integer FROM agent_world.native_chat_control_events e
              WHERE e.run_id = r.id) AS events,
            (SELECT count(*)::integer FROM agent_world.native_chat_results x
              WHERE x.run_id = r.id) AS results,
            (SELECT count(*)::integer FROM agent_world.native_chat_resource_pulls p
              WHERE p.run_id = r.id) AS pulls,
            (SELECT count(*)::integer FROM agent_world.context_items c
              WHERE c.run_id = r.id AND c.kind = 'AGENT_RESULT') AS result_context,
            (SELECT count(*)::integer FROM agent_world.memory_proposals m
              WHERE m.source_context_item_id =
                'context_item_c8c8c8c8-c8c8-c8c8-c8c8-c8c8c8c8c8c8') AS memory_proposals,
            (SELECT count(*)::integer FROM agent_world.memory_events me
              WHERE me.proposal_id =
                'memory_proposal_c8c8c8c8-c8c8-c8c8-c8c8-c8c8c8c8c8c8') AS memory_events,
            s.status AS world_status
       FROM agent_world.runs r
       JOIN agent_world.native_chat_dispatches d ON d.run_id = r.id
       JOIN agent_world.world_agent_status s ON s.agent_id = r.agent_id
      WHERE r.id = $1`,
    [nativeChat.run],
  );
  if (
    nativeChatEvidence.rows[0]?.status !== "COMPLETED" ||
    nativeChatEvidence.rows[0]?.state !== "ATTACHED" ||
    nativeChatEvidence.rows[0]?.last_sequence !== 3 ||
    nativeChatEvidence.rows[0]?.events !== 3 ||
    nativeChatEvidence.rows[0]?.results !== 1 ||
    nativeChatEvidence.rows[0]?.pulls !== 1 ||
    nativeChatEvidence.rows[0]?.result_context !== 1 ||
    nativeChatEvidence.rows[0]?.memory_proposals !== 1 ||
    nativeChatEvidence.rows[0]?.memory_events !== 1 ||
    nativeChatEvidence.rows[0]?.world_status !== "IDLE"
  ) {
    throw new Error("Native Chat Control events did not project one exact terminal result");
  }

  if (
    (await missionStore.materializeDecomposition(decomposition.id, "2026-08-13T09:20:00.000Z"))
      .outcome !== "CREATED" ||
    (await missionStore.materializeDecomposition(decomposition.id, "2026-08-13T09:21:00.000Z"))
      .outcome !== "REPLAY"
  ) {
    throw new Error("Mission Task materialization idempotency drifted");
  }
  const materializedTasks = await pool.query(
    `SELECT task.id, task.conversation_id, task.mission_id, approval.state,
            dependency.depends_on_task_id
       FROM agent_world.tasks task
       JOIN agent_world.approvals approval ON approval.task_id = task.id
       LEFT JOIN agent_world.mission_task_dependencies dependency ON dependency.task_id = task.id
      WHERE task.mission_id = $1
      ORDER BY task.id`,
    [mission.id],
  );
  const initialMissionApprovals = await pool.query(
    `SELECT count(*)::integer AS count
       FROM agent_world.world_events event
       JOIN agent_world.tasks task ON task.id = event.task_id
      WHERE task.mission_id = $1
        AND event.event_type = 'APPROVAL_STATE_CHANGED'
        AND event.approval_state = 'PENDING'`,
    [mission.id],
  );
  if (
    materializedTasks.rows.length !== 2 ||
    materializedTasks.rows.some(
      ({ conversation_id, mission_id, state }) =>
        conversation_id !== null || mission_id !== mission.id || state !== "PENDING",
    ) ||
    materializedTasks.rows[1]?.depends_on_task_id !== decomposition.tasks[0].taskId ||
    initialMissionApprovals.rows[0]?.count !== 1
  ) {
    throw new Error("Mission decomposition did not create transport-neutral dependent Tasks");
  }
  try {
    await approvalStore.decide({
      taskId: decomposition.tasks[1].taskId,
      approvalId: `approval_${decomposition.tasks[1].taskId.slice("task_".length)}`,
      decision: "APPROVE",
      commandId: `approval-decision:approve:${decomposition.tasks[1].taskId.slice("task_".length)}`,
      decidedAt: "2026-08-13T09:25:00.000Z",
    });
    throw new Error("Mission dependency guard accepted an incomplete downstream Task");
  } catch (error) {
    if (error?.code !== "DEPENDENCIES_INCOMPLETE") throw error;
  }
  const predecessorTask = decomposition.tasks[0];
  const downstreamTask = decomposition.tasks[1];
  await pool.query(
    `UPDATE agent_world.approvals
        SET state = 'APPROVED', decided_at = $2, decision_command_id = $3
      WHERE task_id = $1`,
    [
      predecessorTask.taskId,
      "2026-08-13T13:10:00.000Z",
      `mission-root-approval:${predecessorTask.taskId.slice("task_".length)}`,
    ],
  );
  await pool.query(
    `INSERT INTO agent_world.runs
       (id, task_id, conversation_id, agent_id, approval_id, adapter_kind,
        binding_id, session_id, route_id, account_id, execution_mode,
        status, attempt, dispatch_idempotency_key, external_run_id,
        created_at, started_at, completed_at)
     VALUES ($1, $2, NULL, $3, $4, 'NATIVE_CHATGPT', NULL, NULL, $5, $6, 'CHAT',
             'COMPLETED', 1, $7, $8, $9, $9, $10)`,
    [
      `run_${predecessorTask.taskId.slice("task_".length)}`,
      predecessorTask.taskId,
      predecessorTask.assigneeAgentId,
      `approval_${predecessorTask.taskId.slice("task_".length)}`,
      nativeChat.route,
      codex.account,
      `mission-root-run:${predecessorTask.taskId.slice("task_".length)}`,
      `mission-root-external:${predecessorTask.taskId.slice("task_".length)}`,
      "2026-08-13T13:10:00.000Z",
      "2026-08-13T13:15:00.000Z",
    ],
  );
  const handoffEventIds = [
    "event_d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1",
    "event_d2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2",
  ];
  const handoffStore = new PostgresMissionHandoffStore(pool, {
    eventId: () => handoffEventIds.shift() ?? "exhausted",
  });
  const activatedHandoffs = await handoffStore.activateReady("2026-08-13T13:20:00.000Z", 10);
  const replayedHandoffs = await handoffStore.activateReady("2026-08-13T13:20:00.000Z", 10);
  const handoffEvidence = await pool.query(
    `SELECT handoff.from_task_id, handoff.to_task_id, handoff.from_run_id,
            approval.requested_at, approval.expires_at,
            (SELECT count(*)::integer FROM agent_world.world_events event
              WHERE event.task_id = handoff.to_task_id
                AND event.event_type = 'APPROVAL_STATE_CHANGED'
                AND event.approval_state = 'PENDING') AS pending_events
       FROM agent_world.mission_handoffs handoff
       JOIN agent_world.approvals approval ON approval.id = handoff.approval_id
      WHERE handoff.to_task_id = $1`,
    [downstreamTask.taskId],
  );
  if (
    activatedHandoffs.length !== 1 ||
    replayedHandoffs.length !== 0 ||
    handoffEvidence.rows[0]?.from_task_id !== predecessorTask.taskId ||
    handoffEvidence.rows[0]?.to_task_id !== downstreamTask.taskId ||
    handoffEvidence.rows[0]?.from_run_id !==
      `run_${predecessorTask.taskId.slice("task_".length)}` ||
    handoffEvidence.rows[0]?.requested_at?.toISOString() !== "2026-08-13T13:20:00.000Z" ||
    handoffEvidence.rows[0]?.expires_at?.toISOString() !== "2026-08-13T13:35:00.000Z" ||
    handoffEvidence.rows[0]?.pending_events !== 1
  ) {
    throw new Error("Mission handoff did not activate one provenance-linked downstream approval");
  }
  const handoffWorld = await new PostgresWorldProjectionStore(pool).readWorld([
    worldAgent,
    AgentSchema.parse({
      schemaVersion: 1,
      id: hub.secondaryAgent,
      slug: "protocol-reviewer",
      displayName: "Protocol Reviewer",
      role: "Independent review",
      instructions: "Review canonical protocol evidence.",
      isEnabled: true,
    }),
  ]);
  if (
    handoffWorld.handoffs.length !== 1 ||
    handoffWorld.handoffs[0]?.fromTaskId !== predecessorTask.taskId ||
    handoffWorld.handoffs[0]?.toTaskId !== downstreamTask.taskId ||
    handoffWorld.handoffs[0]?.fromAgentId !== worldAgent.id ||
    handoffWorld.handoffs[0]?.toAgentId !== hub.secondaryAgent
  ) {
    throw new Error("Canonical Mission handoff was not projected into the World read model");
  }
  const policyCandidates = await handoffStore.listPolicyAuthorized(10);
  if (
    policyCandidates.length !== 1 ||
    policyCandidates[0]?.taskId !== downstreamTask.taskId ||
    policyCandidates[0]?.approvalId !== `approval_${downstreamTask.taskId.slice("task_".length)}`
  ) {
    throw new Error("Mission policy did not expose exactly one durable auto-approval candidate");
  }
  const autoApprovalEventIds = [
    "event_d3d3d3d3-d3d3-d3d3-d3d3-d3d3d3d3d3d3",
    "event_d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4",
  ];
  await new PostgresResourceBrokerStore(pool).recordObservation({
    routeId: nativeChat.route,
    observedAt: "2026-08-13T13:20:00.500Z",
    expiresAt: "2026-08-13T13:30:00.000Z",
    isAvailable: true,
    quality: 0.9,
    remainingLimits: 0.9,
    cost: 0.8,
    speed: 0.8,
    load: 0.9,
    sourceKind: "HEALTHCHECK",
    sourceRef: "mission-auto-handoff:isolated-ready",
  });
  const autoApprovalStore = new PostgresApprovalRunStore(pool, {
    eventId: () => autoApprovalEventIds.shift() ?? "exhausted",
  });
  const autoApproval = await autoApprovalStore.decide({
    taskId: downstreamTask.taskId,
    approvalId: `approval_${downstreamTask.taskId.slice("task_".length)}`,
    decision: "APPROVE",
    commandId: `mission-auto-approve:${downstreamTask.taskId.slice("task_".length)}`,
    decidedAt: "2026-08-13T13:20:01.000Z",
  });
  const replayedAutoApproval = await autoApprovalStore.decide({
    taskId: downstreamTask.taskId,
    approvalId: `approval_${downstreamTask.taskId.slice("task_".length)}`,
    decision: "APPROVE",
    commandId: `mission-auto-approve:${downstreamTask.taskId.slice("task_".length)}`,
    decidedAt: "2026-08-13T13:20:01.000Z",
  });
  if (
    autoApproval.outcome !== "DECIDED" ||
    autoApproval.run?.status !== "DISPATCH_PENDING" ||
    replayedAutoApproval.outcome !== "REPLAY" ||
    (await handoffStore.listPolicyAuthorized(10)).length !== 0
  ) {
    throw new Error("Policy-authorized handoff did not create one replay-safe downstream Run");
  }

  const scheduleTaskIds = ["task_b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1"];
  const scheduleFiringIds = ["schedule_firing_b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2"];
  const scheduleEventIds = [
    "event_b3b3b3b3-b3b3-b3b3-b3b3-b3b3b3b3b3b3",
    "event_b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4",
  ];
  const scheduleStore = new PostgresScheduleStore(
    pool,
    ({ after }) =>
      after === "2026-08-13T10:00:00.000Z"
        ? "2026-08-14T06:00:00.000Z"
        : "2026-08-16T06:00:00.000Z",
    {
      taskId: () => scheduleTaskIds.shift() ?? "exhausted",
      firingId: () => scheduleFiringIds.shift() ?? "exhausted",
      eventId: () => scheduleEventIds.shift() ?? "exhausted",
    },
  );
  const schedule = {
    schemaVersion: 1,
    id: "schedule_b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5",
    projectId: ids.project,
    agentId: ids.agent,
    missionId: mission.id,
    title: "Daily protocol review",
    taskDescription: "Review canonical protocol evidence.",
    cronExpression: "0 9 * * *",
    timezone: "Europe/Moscow",
    isEnabled: true,
    nextFireAt: "2026-08-14T06:00:00.000Z",
    createdAt: "2026-08-13T10:00:00.000Z",
    updatedAt: "2026-08-13T10:00:00.000Z",
  };
  if (
    (await scheduleStore.create(schedule)).outcome !== "CREATED" ||
    (await scheduleStore.create(schedule)).outcome !== "REPLAY"
  ) {
    throw new Error("Agent Schedule creation idempotency drifted");
  }
  const fired = await scheduleStore.materializeDue("2026-08-15T10:00:00.000Z");
  const replayedDue = await scheduleStore.materializeDue("2026-08-15T10:00:00.000Z");
  const scheduleEvidence = await pool.query(
    `SELECT schedule.next_fire_at, firing.scheduled_for, task.mission_id,
            task.conversation_id, approval.state
       FROM agent_world.agent_schedules schedule
       JOIN agent_world.schedule_firings firing ON firing.schedule_id = schedule.id
       JOIN agent_world.tasks task ON task.id = firing.task_id
       JOIN agent_world.approvals approval ON approval.task_id = task.id
      WHERE schedule.id = $1`,
    [schedule.id],
  );
  if (
    fired.length !== 1 ||
    replayedDue.length !== 0 ||
    scheduleEvidence.rows[0]?.next_fire_at?.toISOString() !== "2026-08-16T06:00:00.000Z" ||
    scheduleEvidence.rows[0]?.scheduled_for?.toISOString() !== schedule.nextFireAt ||
    scheduleEvidence.rows[0]?.mission_id !== mission.id ||
    scheduleEvidence.rows[0]?.conversation_id !== null ||
    scheduleEvidence.rows[0]?.state !== "PENDING"
  ) {
    throw new Error("Restart-safe Agent Schedule firing did not materialize one canonical Task");
  }
  const operations = await new PostgresOperationsReader(
    pool,
    () => new Date("2026-08-15T12:00:00.000Z"),
  ).read();
  if (
    operations.actionGraph.nodes.length === 0 ||
    operations.actionGraph.edges.length === 0 ||
    operations.observatory.tokens.input === 0 ||
    operations.observatory.context.budgetTokens === 0 ||
    operations.observatory.routeSignals.length === 0 ||
    operations.observatory.monetaryCost.status !== "ESTIMATED" ||
    operations.observatory.monetaryCost.amountUsd !== 0.00042 ||
    operations.observatory.monetaryCost.source !== "LITELLM_RESPONSE_HEADER" ||
    !operations.actionGraph.nodes.some(
      (node) =>
        node.kind === "RUN" &&
        node.id === apiRunId &&
        node.adapterKind === "API_MODEL" &&
        node.resultSummary?.includes("API execution persisted"),
    )
  ) {
    throw new Error(
      "Operations read model did not project graph and truthful observability evidence",
    );
  }
  const integrationStore = new PostgresIntegrationStore(
    pool,
    () => new Date("2026-08-15T12:00:00.000Z"),
  );
  const mcpIntegration = {
    id: "integration_e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1",
    commandId: "integration:create:mcp-isolated",
    kind: "MCP",
    label: "AI World MCP",
    endpoint: { transport: "HTTPS", url: "https://world.example/api/mcp" },
    createdAt: "2026-08-15T11:00:00.000Z",
  };
  const sshIntegration = {
    id: "integration_e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2",
    commandId: "integration:create:ssh-isolated",
    kind: "SSH",
    label: "Timeweb VDS",
    endpoint: { transport: "SSH", host: "vds.example", port: 22, username: "agent-world" },
    createdAt: "2026-08-15T11:01:00.000Z",
  };
  if (
    (await integrationStore.create(mcpIntegration)).outcome !== "CREATED" ||
    (await integrationStore.create(mcpIntegration)).outcome !== "REPLAY" ||
    (await integrationStore.create(sshIntegration)).outcome !== "CREATED"
  ) {
    throw new Error("Integration registry command replay drifted");
  }
  const integrationSecretRef = `secret-store:integrations/${mcpIntegration.id}/credential`;
  await secretStore.write({
    commandId: "integration:credential:mcp-isolated",
    secretRef: integrationSecretRef,
    purpose: "INTEGRATION_CREDENTIAL",
    plaintext: "isolated-mcp-token",
    writtenAt: "2026-08-15T11:02:00.000Z",
  });
  await integrationStore.bindCredential(
    mcpIntegration.id,
    integrationSecretRef,
    "2026-08-15T11:02:00.000Z",
  );
  const disableIntegration = {
    operation: "DISABLE",
    integrationId: mcpIntegration.id,
    commandId: "integration:disable:mcp-isolated",
    updatedAt: "2026-08-15T11:03:00.000Z",
  };
  if (
    (await integrationStore.setEnabled(disableIntegration)).outcome !== "UPDATED" ||
    (await integrationStore.setEnabled(disableIntegration)).outcome !== "REPLAY"
  ) {
    throw new Error("Integration lifecycle replay drifted");
  }
  await integrationStore.setEnabled({
    operation: "ENABLE",
    integrationId: mcpIntegration.id,
    commandId: "integration:enable:mcp-isolated",
    updatedAt: "2026-08-15T11:04:00.000Z",
  });
  const probeCommand = {
    integrationId: mcpIntegration.id,
    commandId: "integration:test:mcp-isolated",
  };
  if ((await integrationStore.prepareProbe(probeCommand)).outcome !== "READY") {
    throw new Error("Integration probe was not prepared from canonical configuration");
  }
  const committedProbe = await integrationStore.commitProbe(
    probeCommand,
    { health: "ERROR", code: "HOST_NOT_ALLOWLISTED" },
    "2026-08-15T11:05:00.000Z",
  );
  const replayedProbe = await integrationStore.prepareProbe(probeCommand);
  if (committedProbe.outcome !== "RECORDED" || replayedProbe.outcome !== "REPLAY") {
    throw new Error("Integration probe observation replay drifted");
  }
  const integrationRegistry = await integrationStore.list();
  if (
    integrationRegistry.integrations.length !== 2 ||
    integrationRegistry.integrations.find(({ id }) => id === mcpIntegration.id)?.hasCredential !==
      true ||
    integrationRegistry.integrations.find(({ id }) => id === mcpIntegration.id)?.isEnabled !==
      true ||
    integrationRegistry.integrations.find(({ id }) => id === mcpIntegration.id)?.health !==
      "ERROR" ||
    (await secretStore.read(integrationSecretRef, "INTEGRATION_CREDENTIAL")) !==
      "isolated-mcp-token" ||
    JSON.stringify(integrationRegistry).includes("secret-store:")
  ) {
    throw new Error("Integration registry did not preserve safe MCP and SSH boundaries");
  }

  process.stdout.write(
    `${JSON.stringify({ status: "PASS", postgresImage: IMAGE, migrations: migrations.length, tables: names.length, hubScenarios: 15, missionScenarios: 22, scheduleScenarios: 5, executionPreferenceScenarios: 6, resourceBrokerScenarios: 7, nativeChatLauncherScenarios: 5, secretStoreScenarios: 2, modelRouteScenarios: 2, conversationStoreScenarios: 11, conversationReaderScenarios: 2, ownerAuthScenarios: 6, worldReplayScenarios: 4, runtimeMessageScenarios: 3, taskAssignmentScenarios: 5, sharedContextScenarios: 14, memoryCurationScenarios: 12, memoryProjectionScenarios: 10, codexExecutionScenarios: 23, nativeChatControlScenarios: 9, nativeChatPullScenarios: 7 })}\n`,
  );
} finally {
  await pool?.end().catch(() => undefined);
  await runDocker(["rm", "--force", "--volumes", containerName], { allowFailure: true });
}
