import pg from "pg";

const { Pool } = pg;
const SCHEMA = "agent_world_oauth";

function databaseUrl(value) {
  if (!value) throw new Error("DATABASE_URL is required");
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }
  return value;
}

export function createAuthPool(connectionString = process.env.DATABASE_URL) {
  return new Pool({
    connectionString: databaseUrl(connectionString),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "agent_world_native_chat_auth",
  });
}

function payloadFrom(row) {
  if (!row) return undefined;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  const payload = structuredClone(row.payload);
  if (row.consumed_at) payload.consumed = Math.floor(new Date(row.consumed_at).getTime() / 1_000);
  return payload;
}

export function createPostgresAdapter(pool) {
  return class PostgresAdapter {
    constructor(name) {
      this.name = name;
    }

    async upsert(id, payload, expiresIn) {
      const expiresAt =
        Number.isFinite(expiresIn) && expiresIn > 0
          ? new Date(Date.now() + expiresIn * 1_000)
          : null;
      await pool.query(
        `INSERT INTO ${SCHEMA}.oidc_store
           (model, id, payload, expires_at, consumed_at, grant_id, user_code, uid)
         VALUES ($1, $2, $3::jsonb, $4, NULL, $5, $6, $7)
         ON CONFLICT (model, id) DO UPDATE SET
           payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at,
           consumed_at = NULL, grant_id = EXCLUDED.grant_id,
           user_code = EXCLUDED.user_code, uid = EXCLUDED.uid`,
        [
          this.name,
          id,
          JSON.stringify(payload),
          expiresAt,
          payload.grantId ?? null,
          payload.userCode ?? null,
          payload.uid ?? null,
        ],
      );
    }

    async find(id) {
      const { rows } = await pool.query(
        `SELECT payload, expires_at, consumed_at FROM ${SCHEMA}.oidc_store
          WHERE model = $1 AND id = $2`,
        [this.name, id],
      );
      return payloadFrom(rows[0]);
    }

    async findByUserCode(userCode) {
      const { rows } = await pool.query(
        `SELECT payload, expires_at, consumed_at FROM ${SCHEMA}.oidc_store
          WHERE model = $1 AND user_code = $2 ORDER BY expires_at DESC NULLS LAST LIMIT 1`,
        [this.name, userCode],
      );
      return payloadFrom(rows[0]);
    }

    async findByUid(uid) {
      const { rows } = await pool.query(
        `SELECT payload, expires_at, consumed_at FROM ${SCHEMA}.oidc_store
          WHERE model = $1 AND uid = $2 ORDER BY expires_at DESC NULLS LAST LIMIT 1`,
        [this.name, uid],
      );
      return payloadFrom(rows[0]);
    }

    async consume(id) {
      await pool.query(
        `UPDATE ${SCHEMA}.oidc_store SET consumed_at = COALESCE(consumed_at, clock_timestamp())
          WHERE model = $1 AND id = $2`,
        [this.name, id],
      );
    }

    async destroy(id) {
      await this.deleteWhere("id", id);
    }

    async revokeByGrantId(grantId) {
      await this.deleteWhere("grant_id", grantId);
    }

    async deleteWhere(column, value) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL agent_world.oauth_maintenance = 'on'");
        await client.query(`DELETE FROM ${SCHEMA}.oidc_store WHERE model = $1 AND ${column} = $2`, [
          this.name,
          value,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export async function assertAuthStorageReady(pool) {
  const { rows } = await pool.query(`SELECT
    to_regclass('${SCHEMA}.oidc_store') IS NOT NULL AS oidc_store,
    to_regclass('${SCHEMA}.login_throttle') IS NOT NULL AS login_throttle,
    to_regclass('${SCHEMA}.account_grants') IS NOT NULL AS account_grants`);
  if (!rows[0]?.oidc_store || !rows[0]?.login_throttle || !rows[0]?.account_grants) {
    throw new Error("native Chat OAuth storage is not bootstrapped");
  }
}

export async function listEligibleChatAccounts(pool) {
  const { rows } = await pool.query(
    `SELECT a.id, a.label FROM agent_world.accounts a
       JOIN agent_world.account_surfaces s ON s.account_id = a.id AND s.surface = 'CHAT'
      WHERE EXISTS (
        SELECT 1 FROM agent_world.execution_routes r
         WHERE r.account_id = a.id AND r.mode = 'CHAT'
           AND r.adapter_kind = 'NATIVE_CHATGPT' AND r.is_enabled
      ) ORDER BY a.created_at, a.id LIMIT 20`,
  );
  return rows;
}

export async function recordAccountGrant(pool, { grantId, clientId, accountId }) {
  await pool.query(
    `INSERT INTO ${SCHEMA}.account_grants (grant_id, client_id, account_id)
     VALUES ($1, $2, $3) ON CONFLICT (grant_id) DO UPDATE SET
       account_id = CASE WHEN ${SCHEMA}.account_grants.client_id = EXCLUDED.client_id
                         THEN EXCLUDED.account_id ELSE ${SCHEMA}.account_grants.account_id END`,
    [grantId, clientId, accountId],
  );
}

export async function getLoginThrottle(pool, keys) {
  const { rows } = await pool.query(
    `SELECT failures, locked_until FROM ${SCHEMA}.login_throttle
      WHERE throttle_key = ANY($1::text[])`,
    [keys],
  );
  return rows;
}

export async function recordLoginFailure(pool, keys) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const key of keys) {
      await client.query(
        `INSERT INTO ${SCHEMA}.login_throttle
           (throttle_key, failures, locked_until, updated_at)
         VALUES ($1, 1, NULL, clock_timestamp())
         ON CONFLICT (throttle_key) DO UPDATE SET
           failures = ${SCHEMA}.login_throttle.failures + 1,
           locked_until = CASE WHEN ${SCHEMA}.login_throttle.failures + 1 >= 5
             THEN clock_timestamp() + make_interval(secs => LEAST(3600,
               30 * power(2, LEAST(7, ${SCHEMA}.login_throttle.failures - 4)))::int)
             ELSE ${SCHEMA}.login_throttle.locked_until END,
           updated_at = clock_timestamp()`,
        [key],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function clearLoginThrottle(pool, keys) {
  await pool.query(`DELETE FROM ${SCHEMA}.login_throttle WHERE throttle_key = ANY($1::text[])`, [
    keys,
  ]);
}

export async function cleanupExpiredAuthState(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL agent_world.oauth_maintenance = 'on'");
    await client.query(
      `DELETE FROM ${SCHEMA}.oidc_store
        WHERE expires_at IS NOT NULL AND expires_at < clock_timestamp() - INTERVAL '5 minutes'`,
    );
    await client.query(
      `DELETE FROM ${SCHEMA}.login_throttle
        WHERE updated_at < clock_timestamp() - INTERVAL '24 hours'`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
