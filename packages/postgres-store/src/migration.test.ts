import { describe, expect, it } from "vitest";
import { applyMigrations, discoverMigrations, type Migration } from "./migration.js";

const migration: Migration = {
  version: 1,
  name: "0001_first.sql",
  checksum: "a".repeat(64),
  sql: "CREATE TABLE example (id integer PRIMARY KEY);",
};

describe("discoverMigrations", () => {
  it("loads the canonical SQL migration with a stable SHA-256 checksum", async () => {
    const migrations = await discoverMigrations();

    expect(migrations.map(({ name, version }) => ({ name, version }))).toEqual([
      { version: 1, name: "0001_canonical_core.sql" },
      { version: 2, name: "0002_owner_auth.sql" },
      { version: 3, name: "0003_world_projection.sql" },
      { version: 4, name: "0004_runtime_message_inbox.sql" },
      { version: 5, name: "0005_task_assignment.sql" },
      { version: 6, name: "0006_canonical_hub.sql" },
      { version: 7, name: "0007_hub_commands.sql" },
      { version: 8, name: "0008_execution_preferences.sql" },
      { version: 9, name: "0009_approval_runs.sql" },
      { version: 10, name: "0010_encrypted_secrets.sql" },
      { version: 11, name: "0011_codex_execution.sql" },
      { version: 12, name: "0012_codex_route_policy.sql" },
      { version: 13, name: "0013_codex_route_command.sql" },
      { version: 14, name: "0014_codex_worker_readiness.sql" },
      { version: 15, name: "0015_native_chat_control.sql" },
      { version: 16, name: "0016_native_chat_oauth.sql" },
      { version: 17, name: "0017_native_chat_resource_pulls.sql" },
      { version: 18, name: "0018_transport_run_provenance.sql" },
      { version: 19, name: "0019_resource_broker.sql" },
      { version: 20, name: "0020_native_chat_launcher.sql" },
      { version: 21, name: "0021_shared_context_rag.sql" },
      { version: 22, name: "0022_context_packs.sql" },
      { version: 23, name: "0023_structured_codex_results.sql" },
      { version: 24, name: "0024_memory_curation.sql" },
      { version: 25, name: "0025_memory_event_stream.sql" },
      { version: 26, name: "0026_missions_agent_templates.sql" },
      { version: 27, name: "0027_native_chat_reconciliation.sql" },
      { version: 28, name: "0028_resource_broker_events.sql" },
      { version: 29, name: "0029_mission_collaboration.sql" },
      { version: 30, name: "0030_mission_task_materialization.sql" },
      { version: 31, name: "0031_mission_review_evidence.sql" },
      { version: 32, name: "0032_agent_schedules.sql" },
      { version: 33, name: "0033_mission_handoffs.sql" },
      { version: 34, name: "0034_mission_execution_policy.sql" },
      { version: 35, name: "0035_integration_registry.sql" },
      { version: 36, name: "0036_integration_probe_observations.sql" },
      { version: 37, name: "0037_integration_action_observations.sql" },
      { version: 38, name: "0038_model_execution_jobs.sql" },
      { version: 39, name: "0039_model_execution_hub_commands.sql" },
      { version: 40, name: "0040_atomic_model_agent_route.sql" },
      { version: 41, name: "0041_integration_mutation_approvals.sql" },
      { version: 42, name: "0042_integration_tool_allowlist.sql" },
      { version: 43, name: "0043_integration_ssh_operation_allowlist.sql" },
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(migrations[0]?.sql).toContain("CREATE TABLE agent_world.conversation_messages");
    expect(migrations[1]?.sql).toContain("CREATE TABLE agent_world.owner_sessions");
    expect(migrations[2]?.sql).toContain("CREATE TABLE agent_world.world_events");
    expect(migrations[3]?.sql).toContain("conversation_messages_runtime_identity");
    expect(migrations[4]?.sql).toContain("CREATE TABLE agent_world.tasks");
    expect(migrations[5]?.sql).toContain("CREATE TABLE agent_world.canonical_models");
    expect(migrations[5]?.sql).toContain("CREATE TABLE agent_world.model_routes");
    expect(migrations[6]?.sql).toContain("CREATE TABLE agent_world.hub_command_receipts");
    expect(migrations[7]?.sql).toContain("CREATE TABLE agent_world.execution_preference_overrides");
    expect(migrations[8]?.sql).toContain("CREATE TABLE agent_world.approvals");
    expect(migrations[8]?.sql).toContain("CREATE TABLE agent_world.runs");
    expect(migrations[9]?.sql).toContain("CREATE TABLE agent_world.encrypted_secrets");
    expect(migrations[10]?.sql).toContain("CREATE TABLE agent_world.codex_execution_jobs");
    expect(migrations[10]?.sql).toContain("CREATE TABLE agent_world.codex_execution_events");
    expect(migrations[11]?.sql).toContain("CREATE TABLE agent_world.codex_execution_policies");
    expect(migrations[12]?.sql).toContain("'CODEX_ROUTE_CREATE'");
    expect(migrations[13]?.sql).toContain("CREATE TABLE agent_world.codex_worker_readiness");
    expect(migrations[14]?.sql).toContain("CREATE TABLE agent_world.native_chat_dispatches");
    expect(migrations[14]?.sql).toContain("CREATE TABLE agent_world.native_chat_control_events");
    expect(migrations[14]?.sql).toContain("runs_native_chat_provenance_key");
    expect(migrations[17]?.sql).toContain("runs_transport_provenance_shape_check");
    expect(migrations[17]?.sql).toContain("FROM agent_world.native_chat_dispatches AS dispatch");
    expect(migrations[18]?.sql).toContain("CREATE TABLE agent_world.resource_route_observations");
    expect(migrations[18]?.sql).toContain("CREATE TABLE agent_world.resource_broker_decisions");
    expect(migrations[19]?.sql).toContain("CREATE TABLE agent_world.native_chat_browser_profiles");
    expect(migrations[19]?.sql).toContain("native_chat_dispatches_launcher_shape_check");
    expect(migrations[20]?.sql).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(migrations[20]?.sql).toContain("CREATE TABLE agent_world.rag_document_chunks");
    expect(migrations[20]?.sql).toContain("USING hnsw (embedding vector_cosine_ops)");
    expect(migrations[21]?.sql).toContain("CREATE TABLE agent_world.context_packs");
    expect(migrations[21]?.sql).toContain("CREATE TABLE agent_world.context_pack_evidence");
    expect(migrations[22]?.sql).toContain("ADD COLUMN structured_result jsonb");
    expect(migrations[23]?.sql).toContain("CREATE TABLE agent_world.memory_proposals");
    expect(migrations[23]?.sql).toContain("CREATE TABLE agent_world.memory_curation_decisions");
    expect(migrations[24]?.sql).toContain("CREATE TABLE agent_world.memory_events");
    expect(migrations[24]?.sql).toContain("CREATE TABLE agent_world.memory_projection_checkpoints");
    expect(migrations[25]?.sql).toContain("CREATE TABLE agent_world.missions");
    expect(migrations[25]?.sql).toContain("CREATE TABLE agent_world.agent_templates");
    expect(migrations[26]?.sql).toContain("begin_deadline_at");
    expect(migrations[26]?.sql).toContain("native_chat_dispatches_expired_completion");
    expect(migrations[27]?.sql).toContain("CREATE TABLE agent_world.resource_broker_events");
    expect(migrations[28]?.sql).toContain("CREATE TABLE agent_world.structured_meetings");
    expect(migrations[29]?.sql).toContain("CREATE TABLE agent_world.mission_task_dependencies");
    expect(migrations[32]?.sql).toContain("CREATE TABLE agent_world.mission_handoffs");
    expect(migrations[32]?.sql).toContain("CREATE TABLE agent_world.mission_handoff_activations");
    expect(migrations[33]?.sql).toContain("AUTO_SAFE_HANDOFF");
    expect(migrations[34]?.sql).toContain("CREATE TABLE agent_world.integration_endpoints");
    expect(migrations[35]?.sql).toContain(
      "CREATE TABLE agent_world.integration_probe_observations",
    );
    expect(migrations[36]?.sql).toContain(
      "CREATE TABLE agent_world.integration_action_observations",
    );
    expect(migrations[37]?.sql).toContain("CREATE TABLE agent_world.model_execution_jobs");
    expect(migrations[38]?.sql).toContain("'MODEL_EXECUTION_ROUTE_CREATE'");
    expect(migrations[38]?.sql).toContain("'AGENT_ROUTE_BIND'");
    expect(migrations[39]?.sql).toContain("'MODEL_AGENT_ROUTE_PROVISION'");
    expect(migrations[40]?.sql).toContain("CREATE TABLE agent_world.integration_mutation_requests");
    expect(migrations[41]?.sql).toContain("CREATE TABLE agent_world.integration_tool_allowlist");
    expect(migrations[42]?.sql).toContain(
      "CREATE TABLE agent_world.integration_ssh_operation_allowlist",
    );
    expect(migrations[30]?.sql).toContain(
      "CREATE TABLE agent_world.structured_meeting_criterion_assessments",
    );
    expect(migrations[31]?.sql).toContain("CREATE TABLE agent_world.agent_schedules");
  });

  it("rejects duplicate versions and non-canonical migration filenames", async () => {
    await expect(
      discoverMigrations({
        listFiles: async () => ["0001_first.sql", "0001_second.sql"],
        readFile: async () => "SELECT 1;",
      }),
    ).rejects.toThrow("Duplicate migration version");
    await expect(
      discoverMigrations({
        listFiles: async () => ["1_bad.sql"],
        readFile: async () => "SELECT 1;",
      }),
    ).rejects.toThrow("Invalid migration filename");
  });
});

describe("applyMigrations", () => {
  it("holds an advisory transaction lock and records new migrations", async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
    const client = {
      query: async (text: string, values?: readonly unknown[]) => {
        calls.push({ text, ...(values === undefined ? {} : { values }) });
        if (text.includes("SELECT version, name, checksum")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    await applyMigrations(client as never, [migration]);

    expect(calls[0]?.text).toBe("BEGIN");
    expect(calls[1]).toMatchObject({
      text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      values: ["agent_world:schema_migrations"],
    });
    expect(calls.some(({ text }) => text === migration.sql)).toBe(true);
    expect(calls.at(-1)?.text).toBe("COMMIT");
  });

  it("rolls back and rejects checksum drift before applying SQL", async () => {
    const calls: string[] = [];
    const client = {
      query: async (text: string) => {
        calls.push(text);
        if (text.includes("SELECT version, name, checksum")) {
          return {
            rows: [{ version: 1, name: migration.name, checksum: "b".repeat(64) }],
          };
        }
        return { rows: [] };
      },
    };

    await expect(applyMigrations(client as never, [migration])).rejects.toThrow(
      "Migration drift detected",
    );
    expect(calls).not.toContain(migration.sql);
    expect(calls.at(-1)).toBe("ROLLBACK");
  });

  it("rejects a non-prefix migration ledger", async () => {
    const second: Migration = {
      version: 2,
      name: "0002_second.sql",
      checksum: "b".repeat(64),
      sql: "ALTER TABLE example ADD COLUMN value text;",
    };
    const calls: string[] = [];
    const client = {
      query: async (text: string) => {
        calls.push(text);
        if (text.includes("SELECT version, name, checksum")) {
          return { rows: [{ version: 2, name: second.name, checksum: second.checksum }] };
        }
        return { rows: [] };
      },
    };

    await expect(applyMigrations(client as never, [migration, second])).rejects.toThrow(
      "not a contiguous local prefix",
    );
    expect(calls).not.toContain(migration.sql);
    expect(calls.at(-1)).toBe("ROLLBACK");
  });
});
