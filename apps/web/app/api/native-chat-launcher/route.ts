import { PostgresNativeChatLaunchStore } from "@agent-world/postgres-store";
import { Pool } from "pg";
import {
  createNativeChatLauncherRouteHandler,
  parseNativeChatLauncherControlConfiguration,
} from "../../../src/server/native-chat-launcher-http";

export const dynamic = "force-dynamic";

type LauncherStoreState = {
  pool: Pool;
  store: PostgresNativeChatLaunchStore;
};

const registryKey = Symbol.for("agent-world.native-chat-launcher-control.v1");
const registry = globalThis as typeof globalThis & { [registryKey]?: LauncherStoreState };

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function launcherStore(): PostgresNativeChatLaunchStore {
  const existing = registry[registryKey];
  if (existing) return existing.store;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || connectionString.length > 4_096) {
    throw new Error("Launcher control database is unavailable");
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Launcher control database is unavailable");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Launcher control database is unavailable");
  }
  const tlsMode = process.env.AGENT_WORLD_DATABASE_TLS;
  if (tlsMode !== "verify-full" && tlsMode !== "disable") {
    throw new Error("Launcher control database is unavailable");
  }
  if (
    tlsMode === "disable" &&
    !isLoopback(url.hostname) &&
    process.env.AGENT_WORLD_DATABASE_PLAINTEXT_ACK !== "private-network"
  ) {
    throw new Error("Launcher control database is unavailable");
  }

  const pool = new Pool({
    connectionString,
    ssl: tlsMode === "verify-full" ? { rejectUnauthorized: true } : false,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "agent-world-native-chat-launcher-control",
  });
  pool.on("error", () =>
    console.error(
      JSON.stringify({ component: "native-chat-launcher-control", event: "database_error" }),
    ),
  );
  const state = { pool, store: new PostgresNativeChatLaunchStore(pool) };
  registry[registryKey] = state;
  return state.store;
}

let configuration: ReturnType<typeof parseNativeChatLauncherControlConfiguration>;
try {
  configuration = parseNativeChatLauncherControlConfiguration(process.env);
} catch {
  configuration = undefined;
  console.error(
    JSON.stringify({ component: "native-chat-launcher-control", event: "configuration_rejected" }),
  );
}

const handler = createNativeChatLauncherRouteHandler(
  {
    claim: (input) => launcherStore().claimNext(input),
    submitted: (input) => launcherStore().markSubmitted(input),
    failure: (input) => launcherStore().recordFailure(input),
  },
  configuration,
);

export const POST = handler;
