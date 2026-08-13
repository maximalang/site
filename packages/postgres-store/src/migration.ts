import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

const MIGRATION_FILENAME = /^(?<version>\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const MIGRATION_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export type Migration = {
  version: number;
  name: string;
  checksum: string;
  sql: string;
};

export type MigrationDiscovery = {
  listFiles?: () => Promise<string[]>;
  readFile?: (name: string) => Promise<string>;
};

export async function discoverMigrations(discovery: MigrationDiscovery = {}): Promise<Migration[]> {
  const listFiles = discovery.listFiles ?? (() => readdir(MIGRATION_DIRECTORY));
  const loadFile =
    discovery.readFile ?? ((name) => readFile(join(MIGRATION_DIRECTORY, name), "utf8"));
  const files = await listFiles();
  const migrations: Migration[] = [];
  const versions = new Set<number>();

  for (const name of files.toSorted()) {
    const match = MIGRATION_FILENAME.exec(name);
    if (!match?.groups?.version) {
      throw new Error(`Invalid migration filename: ${name}`);
    }
    const version = Number.parseInt(match.groups.version, 10);
    if (versions.has(version)) {
      throw new Error(`Duplicate migration version: ${version}`);
    }
    versions.add(version);
    const sql = await loadFile(name);
    if (sql.trim().length === 0) {
      throw new Error(`Migration is empty: ${name}`);
    }
    migrations.push({
      version,
      name,
      checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
      sql,
    });
  }

  return migrations.toSorted((left, right) => left.version - right.version);
}

type AppliedMigrationRow = {
  version: number;
  name: string;
  checksum: string;
};

const BOOTSTRAP_SQL = `
CREATE SCHEMA IF NOT EXISTS agent_world;
CREATE TABLE IF NOT EXISTS agent_world.schema_migrations (
  version integer PRIMARY KEY CHECK (version > 0),
  name text NOT NULL UNIQUE,
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
`;

export async function applyMigrations(
  client: Pick<PoolClient, "query">,
  migrations: readonly Migration[],
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      "agent_world:schema_migrations",
    ]);
    await client.query(BOOTSTRAP_SQL);
    const appliedResult = await client.query<AppliedMigrationRow>(
      "SELECT version, name, checksum FROM agent_world.schema_migrations ORDER BY version",
    );
    const localByVersion = new Map(migrations.map((migration) => [migration.version, migration]));

    for (const applied of appliedResult.rows) {
      const local = localByVersion.get(applied.version);
      if (!local) {
        throw new Error(`Database contains unknown migration version: ${applied.version}`);
      }
      if (local.name !== applied.name || local.checksum !== applied.checksum) {
        throw new Error(`Migration drift detected at version: ${applied.version}`);
      }
    }

    const appliedVersions = new Set(appliedResult.rows.map(({ version }) => version));
    const highestApplied = Math.max(0, ...appliedVersions);
    for (const migration of migrations) {
      if (migration.version < highestApplied && !appliedVersions.has(migration.version)) {
        throw new Error(
          `Migration ledger is not a contiguous local prefix at version: ${migration.version}`,
        );
      }
    }

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO agent_world.schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)`,
        [migration.version, migration.name, migration.checksum],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original migration failure. The caller must discard a
      // connection that cannot roll back cleanly.
    }
    throw error;
  }
}
