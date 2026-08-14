import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { createMissionWorkflow, createPostgresMissionCheckpointer } from "../dist/index.js";

const exec = promisify(execFile);
const ACK = "AGENT_WORLD_LANGGRAPH_TEST_ACK";
const IMAGE =
  "pgvector/pgvector:0.8.6-pg18-bookworm@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a";
if (process.env[ACK] !== "isolated") {
  throw new Error(`${ACK}=isolated is required; the verifier never accepts a user database`);
}

const container = `agent-world-langgraph-${randomUUID()}`;
const missionId = "mission_11111111-1111-1111-1111-111111111111";
let saver;
let pool;
try {
  await exec("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_PASSWORD=isolated-langgraph-test",
    IMAGE,
  ]);
  let port;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { stdout } = await exec("docker", ["port", container, "5432/tcp"]);
    port = stdout.trim().match(/:(\d+)$/)?.[1];
    if (port) {
      try {
        pool = new pg.Pool({
          connectionString: `postgresql://postgres:isolated-langgraph-test@127.0.0.1:${port}/postgres`,
        });
        await pool.query("SELECT 1");
        break;
      } catch {
        await pool?.end().catch(() => undefined);
        pool = undefined;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!port || !pool) throw new Error("Isolated PostgreSQL did not become ready");
  const connectionString = `postgresql://postgres:isolated-langgraph-test@127.0.0.1:${port}/postgres`;
  saver = await createPostgresMissionCheckpointer(connectionString);
  let graph = createMissionWorkflow(saver);
  const config = { configurable: { thread_id: missionId } };
  await graph.invoke(
    {
      schemaVersion: 1,
      missionId,
      taskIds: [],
      runIds: [],
      completedTaskIds: [],
      failedTaskIds: [],
      phase: "PLANNING",
      retryCount: 0,
      maxRetries: 2,
      reviewRequired: true,
    },
    config,
  );
  await saver.end();

  saver = await createPostgresMissionCheckpointer(connectionString);
  graph = createMissionWorkflow(saver);
  const recovered = await graph.getState(config);
  if (
    recovered.values.missionId !== missionId ||
    recovered.values.pendingAction !== "DECOMPOSE_MISSION"
  ) {
    throw new Error("LangGraph checkpoint did not survive a process restart");
  }
  const completed = await graph.invoke(
    {
      ...recovered.values,
      taskIds: ["task_22222222-2222-2222-2222-222222222222"],
      runIds: ["run_33333333-3333-3333-3333-333333333333"],
      completedTaskIds: ["task_22222222-2222-2222-2222-222222222222"],
      failedTaskIds: [],
      reviewRequired: false,
    },
    config,
  );
  if (completed.phase !== "COMPLETED" || completed.pendingAction !== "RECORD_SUCCESS") {
    throw new Error("Recovered LangGraph workflow did not continue deterministically");
  }
  const tables = await pool.query(
    `SELECT count(*)::integer AS count
       FROM information_schema.tables
      WHERE table_schema = 'agent_world_langgraph'`,
  );
  if ((tables.rows[0]?.count ?? 0) < 3)
    throw new Error("LangGraph PostgreSQL schema is incomplete");
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", postgresImage: IMAGE, recovered: true, phase: completed.phase, checkpointTables: tables.rows[0].count })}\n`,
  );
} finally {
  await saver?.end().catch(() => undefined);
  await pool?.end().catch(() => undefined);
  await exec("docker", ["rm", "--force", "--volumes", container]).catch(() => undefined);
}
