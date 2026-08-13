import { createServer } from "node:http";
import { OpenAiCodexSdkRunner } from "@agent-world/codex-adapter";
import { PostgresCodexExecutionStore } from "@agent-world/postgres-store";
import { Pool } from "pg";
import * as z from "zod";
import { checkCodexAuthentication } from "./auth-readiness.js";
import { CodexWorker } from "./worker.js";
import { WorkspacePolicy } from "./workspace-policy.js";

const EnvironmentSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://").max(2_048),
  AGENT_WORLD_DATABASE_TLS: z.enum(["require", "disable"]).default("require"),
  AGENT_WORLD_DATABASE_PLAINTEXT_ACK: z.literal("private-network").optional(),
  AGENT_WORLD_CODEX_ALLOWED_ROOTS: z.string().min(1).max(16_384),
  AGENT_WORLD_CODEX_EXECUTABLE: z
    .string()
    .min(1)
    .max(4_096)
    .default("/app/node_modules/.bin/codex"),
  AGENT_WORLD_CODEX_WORKER_ID: z.string().min(1).max(128).default("codex-worker-1"),
  AGENT_WORLD_CODEX_LEASE_MS: z.coerce.number().int().min(10_000).max(300_000).default(60_000),
  AGENT_WORLD_CODEX_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  AGENT_WORLD_CODEX_HEALTH_PORT: z.coerce.number().int().min(1_024).max(65_535).default(3_100),
});

function boundedLog(event: string, outcome: string) {
  process.stdout.write(`${JSON.stringify({ event, outcome })}\n`);
}

const environment = EnvironmentSchema.parse(process.env);
if (
  environment.AGENT_WORLD_DATABASE_TLS === "disable" &&
  environment.AGENT_WORLD_DATABASE_PLAINTEXT_ACK !== "private-network"
) {
  throw new Error("PLAINTEXT_DATABASE_NOT_ACKNOWLEDGED");
}
const roots = environment.AGENT_WORLD_CODEX_ALLOWED_ROOTS.split(",").map((root) => root.trim());
if (roots.some((root) => root.length === 0)) throw new Error("INVALID_ALLOWED_ROOTS");

const workspacePolicy = await WorkspacePolicy.create(roots);
const pool = new Pool({
  connectionString: environment.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 3_000,
  ssl: environment.AGENT_WORLD_DATABASE_TLS === "require" ? { rejectUnauthorized: true } : false,
});
const store = new PostgresCodexExecutionStore(pool, {
  executionId: () => {
    throw new Error("WORKER_DOES_NOT_DISPATCH");
  },
});
const worker = new CodexWorker({
  store,
  runner: new OpenAiCodexSdkRunner(),
  workspacePolicy,
  workerId: environment.AGENT_WORLD_CODEX_WORKER_ID,
  leaseMs: environment.AGENT_WORLD_CODEX_LEASE_MS,
});
let databaseReady = false;
let authentication: "CHATGPT" | "UNAVAILABLE" = "UNAVAILABLE";
let nextAuthenticationCheckAt = 0;
let stopping = false;
const shutdown = new AbortController();

const healthServer = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(databaseReady ? 200 : 503, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(
    JSON.stringify({
      status: databaseReady ? "available" : "unavailable",
      authentication,
    }),
  );
});
healthServer.listen(environment.AGENT_WORLD_CODEX_HEALTH_PORT, "127.0.0.1");

const stop = () => {
  stopping = true;
  shutdown.abort();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

while (!stopping) {
  try {
    await pool.query("SELECT 1");
    databaseReady = true;
  } catch {
    databaseReady = false;
    authentication = "UNAVAILABLE";
    boundedLog("codex_worker_database", "UNAVAILABLE");
  }
  if (databaseReady) {
    if (Date.now() >= nextAuthenticationCheckAt) {
      authentication = await checkCodexAuthentication(environment.AGENT_WORLD_CODEX_EXECUTABLE);
      nextAuthenticationCheckAt = Date.now() + 30_000;
    }
    if (authentication === "CHATGPT") {
      try {
        const result = await worker.runOnce(shutdown.signal);
        if (result.outcome !== "IDLE") boundedLog("codex_worker_cycle", result.outcome);
      } catch {
        boundedLog("codex_worker_cycle", "FAILED");
      }
    }
  }
  if (!stopping) {
    await new Promise((resolve) => setTimeout(resolve, environment.AGENT_WORLD_CODEX_POLL_MS));
  }
}

await new Promise<void>((resolve) => healthServer.close(() => resolve()));
await pool.end();
