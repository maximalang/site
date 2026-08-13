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
