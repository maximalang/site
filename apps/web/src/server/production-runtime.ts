import { randomUUID } from "node:crypto";
import { ConversationSendService } from "@agent-world/conversation-service";
import {
  type OpenClawCredential,
  OpenClawReadAdapter,
  OpenClawWriteAdapter,
} from "@agent-world/openclaw-adapter";
import {
  applyMigrations,
  discoverMigrations,
  PostgresAgentConversationReader,
  PostgresConversationReader,
  PostgresConversationStore,
  PostgresOpenClawConfigurationReader,
  PostgresOwnerSessionStore,
  PostgresWorldProjectionStore,
} from "@agent-world/postgres-store";
import { Pool, type PoolConfig } from "pg";
import type { ApplicationRuntime } from "./application-runtime";
import { OwnerSessionManager } from "./owner-session";

type RuntimeEnvironment = Record<string, string | undefined>;

type OpenClawRuntimeConfig = {
  endpoint: string;
  credential: OpenClawCredential;
  instanceId: string;
};

function loopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function parseDatabasePoolConfig(environment: RuntimeEnvironment): PoolConfig {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString || connectionString.length > 4_096) {
    throw new Error("DATABASE_URL is required and must be bounded");
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be an absolute PostgreSQL URL");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("DATABASE_URL violates the production connection contract");
  }
  const tlsMode = environment.AGENT_WORLD_DATABASE_TLS;
  if (tlsMode !== "verify-full" && tlsMode !== "disable") {
    throw new Error("AGENT_WORLD_DATABASE_TLS must be verify-full or disable");
  }
  if (
    tlsMode === "disable" &&
    !loopback(url.hostname) &&
    environment.AGENT_WORLD_DATABASE_PLAINTEXT_ACK !== "private-network"
  ) {
    throw new Error("Plaintext PostgreSQL requires an explicit private-network acknowledgement");
  }
  return {
    connectionString,
    ssl: tlsMode === "verify-full" ? { rejectUnauthorized: true } : false,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "agent-world-web",
  };
}

function parseOpenClawRuntimeConfig(
  environment: RuntimeEnvironment,
): OpenClawRuntimeConfig | undefined {
  const endpoint = environment.OPENCLAW_GATEWAY_URL;
  const token = environment.OPENCLAW_GATEWAY_TOKEN;
  const deviceToken = environment.OPENCLAW_GATEWAY_DEVICE_TOKEN;
  if (!endpoint && !token && !deviceToken) {
    return undefined;
  }
  if (!endpoint || (!token && !deviceToken) || (token && deviceToken)) {
    throw new Error("OpenClaw configuration is incomplete or ambiguous");
  }
  const credential: OpenClawCredential = token
    ? { kind: "TOKEN", value: token }
    : deviceToken
      ? { kind: "DEVICE_TOKEN", value: deviceToken }
      : (() => {
          throw new Error("OpenClaw credential is missing");
        })();
  return {
    endpoint,
    credential,
    instanceId: environment.AGENT_WORLD_INSTANCE_ID ?? "agent-world",
  };
}

function record(component: string, event: unknown): void {
  try {
    const serialized = JSON.stringify({ component, event });
    console.info(
      serialized.length <= 4_096 ? serialized : JSON.stringify({ component, event: "oversized" }),
    );
  } catch {
    // Telemetry must never interrupt runtime lifecycle.
  }
}

export async function createProductionRuntime(
  environment: RuntimeEnvironment = process.env,
): Promise<ApplicationRuntime> {
  const pool = new Pool(parseDatabasePoolConfig(environment));
  pool.on("error", () => record("postgres", { event: "unexpected_idle_client_error" }));
  let readAdapter: OpenClawReadAdapter | undefined;
  let writeAdapter: OpenClawWriteAdapter | undefined;
  try {
    const migrationClient = await pool.connect();
    try {
      await migrationClient.query("SELECT 1");
      await applyMigrations(migrationClient, await discoverMigrations());
    } finally {
      migrationClient.release();
    }

    const ownerSessionStore = new PostgresOwnerSessionStore(pool);
    await ownerSessionStore.pruneExpiredSessions(new Date().toISOString());
    const auth = new OwnerSessionManager({
      store: ownerSessionStore,
      passwordHash: environment.AGENT_WORLD_OWNER_PASSWORD_HASH,
      csrfSecret: environment.AGENT_WORLD_CSRF_SECRET,
      secureCookies: environment.NODE_ENV === "production",
    });

    const agentConversationReader = new PostgresAgentConversationReader(pool);
    const conversationReader = new PostgresConversationReader(pool);
    const conversationStore = new PostgresConversationStore(pool);
    const configuration = await new PostgresOpenClawConfigurationReader(pool).read();
    const runtimeObservationId = randomUUID();
    const worldStore = new PostgresWorldProjectionStore(pool, {
      eventId: () => `event_${randomUUID()}`,
    });
    if (configuration.bindings.length > 0) {
      await worldStore.applyOpenClawSnapshot({
        observedAt: new Date().toISOString(),
        observationId: `openclaw-start:${runtimeObservationId}`,
        statuses: configuration.bindings.map(({ agentId, bindingId }) => ({
          agentId,
          bindingId,
          status: "OFFLINE",
        })),
      });
    }

    let openClawConfig: OpenClawRuntimeConfig | undefined;
    try {
      openClawConfig = parseOpenClawRuntimeConfig(environment);
    } catch {
      record("openclaw", { event: "configuration_rejected" });
    }

    if (openClawConfig) {
      try {
        const activeOpenClawConfig = openClawConfig;
        const credentialProvider = async () => activeOpenClawConfig.credential;
        readAdapter = new OpenClawReadAdapter({
          config: {
            endpoint: openClawConfig.endpoint,
            clientVersion: "0.0.0",
            instanceId: `${openClawConfig.instanceId}.read`,
          },
          bindings: configuration.bindings,
          credentialProvider,
          telemetry: { record: (event) => record("openclaw-read", event) },
          onSnapshot: (snapshot) =>
            worldStore.applyOpenClawSnapshot({
              observedAt: snapshot.runtime.receivedAt,
              observationId: `openclaw-observation:${runtimeObservationId}:${snapshot.sourceCursor.connectionEpoch}:${snapshot.sourceCursor.connectionSequence ?? "snapshot"}:${randomUUID()}`,
              statuses: snapshot.runtime.agents.map(({ agentId, bindingId, status }) => ({
                agentId,
                bindingId,
                status,
              })),
            }),
          correlationId: "openclaw-read-runtime",
        });
        writeAdapter = new OpenClawWriteAdapter({
          config: {
            endpoint: openClawConfig.endpoint,
            clientVersion: "0.0.0",
            instanceId: `${openClawConfig.instanceId}.write`,
          },
          credentialProvider,
          telemetry: { record: (event) => record("openclaw-write", event) },
          correlationId: "openclaw-write-runtime",
        });
        await Promise.all([readAdapter.start(), writeAdapter.start()]);
      } catch {
        await Promise.allSettled([readAdapter?.stop(), writeAdapter?.stop()]);
        readAdapter = undefined;
        writeAdapter = undefined;
        record("openclaw", { event: "adapter_start_rejected" });
      }
    }

    const sender = new ConversationSendService({
      store: conversationStore,
      adapters: {
        resolve: (kind) =>
          kind === "OPENCLAW" && writeAdapter?.state === "READY" ? writeAdapter : undefined,
      },
    });

    return {
      auth,
      readAgentConversations: (agentId) => agentConversationReader.read(agentId),
      readConversation: (input) => conversationReader.read(input),
      sendConversation: (input) => sender.send(input),
      readWorld: () => worldStore.readWorld(configuration.agents),
      stop: async () => {
        await Promise.allSettled([readAdapter?.stop(), writeAdapter?.stop()]);
        await pool.end();
      },
    };
  } catch (error) {
    await Promise.allSettled([readAdapter?.stop(), writeAdapter?.stop()]);
    await pool.end().catch(() => undefined);
    throw error;
  }
}
