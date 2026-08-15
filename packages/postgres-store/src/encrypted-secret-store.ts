import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AccountIdSchema, TimestampSchema } from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

const SECRET_REF = /^secret-store:[A-Za-z0-9][A-Za-z0-9._/-]{0,500}$/;
const PURPOSES = ["PROVIDER_API_KEY", "INTEGRATION_CREDENTIAL"] as const;
export type SecretPurpose = (typeof PURPOSES)[number];

export const SECRET_STORE_ERROR_CODES = [
  "INVALID_REFERENCE",
  "IDEMPOTENCY_CONFLICT",
  "NOT_FOUND",
  "DECRYPTION_FAILED",
] as const;
export type SecretStoreErrorCode = (typeof SECRET_STORE_ERROR_CODES)[number];

export class SecretStoreError extends Error {
  override readonly name = "SecretStoreError";

  constructor(readonly code: SecretStoreErrorCode) {
    super(code);
  }
}

export type SecretWriteInput = {
  commandId: string;
  secretRef: string;
  purpose: SecretPurpose;
  plaintext: string;
  writtenAt: string;
};

export type SecretWriteReceipt = {
  schemaVersion: 1;
  outcome: "CREATED" | "ROTATED" | "REPLAY";
  secretRef: string;
  version: number;
};

export type ProviderCredentialWriteInput = {
  commandId: string;
  accountId: string;
  plaintext: string;
  writtenAt: string;
};

export interface SecretStore {
  write(input: SecretWriteInput): Promise<SecretWriteReceipt>;
  read(secretRef: string, purpose: SecretPurpose): Promise<string>;
}

type KeyMaterial = {
  keyVersion: number;
  masterKey: Uint8Array;
};

type ReceiptRow = QueryResultRow & {
  request_sha256: string;
  secret_ref: string;
  version: number;
};

type VersionRow = QueryResultRow & {
  version: number;
  created_at: Date | string;
};

type SecretRow = QueryResultRow & {
  secret_ref: string;
  purpose: string;
  version: number;
  algorithm: string;
  key_version: number;
  nonce: Buffer;
  ciphertext: Buffer;
  auth_tag: Buffer;
};

function validateReference(secretRef: string, purpose: unknown): asserts purpose is SecretPurpose {
  if (!SECRET_REF.test(secretRef) || !PURPOSES.includes(purpose as SecretPurpose)) {
    throw new SecretStoreError("INVALID_REFERENCE");
  }
}

function validateInput(input: SecretWriteInput): void {
  validateReference(input.secretRef, input.purpose);
  if (
    input.commandId.length < 1 ||
    input.commandId.length > 512 ||
    [...input.commandId].some((character) => {
      const point = character.codePointAt(0);
      return point === undefined || point <= 31 || point === 127;
    })
  ) {
    throw new SecretStoreError("INVALID_REFERENCE");
  }
  const bytes = Buffer.byteLength(input.plaintext, "utf8");
  if (bytes < 1 || bytes > 16_384 || input.plaintext.includes("\u0000")) {
    throw new SecretStoreError("INVALID_REFERENCE");
  }
  TimestampSchema.parse(input.writtenAt);
}

function requestHash(input: SecretWriteInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        commandId: input.commandId,
        secretRef: input.secretRef,
        purpose: input.purpose,
        plaintextSha256: createHash("sha256").update(input.plaintext, "utf8").digest("hex"),
        writtenAt: input.writtenAt,
      }),
    )
    .digest("hex");
}

function additionalData(
  secretRef: string,
  purpose: SecretPurpose,
  version: number,
  keyVersion: number,
) {
  return Buffer.from(`${secretRef}\u0000${purpose}\u0000${version}\u0000${keyVersion}`, "utf8");
}

function encrypt(
  plaintext: string,
  secretRef: string,
  purpose: SecretPurpose,
  version: number,
  key: KeyMaterial,
) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.masterKey, nonce, { authTagLength: 16 });
  cipher.setAAD(additionalData(secretRef, purpose, version, key.keyVersion));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { nonce, ciphertext, authTag: cipher.getAuthTag() };
}

export class PostgresEncryptedSecretStore implements SecretStore {
  private readonly key: KeyMaterial;

  constructor(
    private readonly pool: TransactionPool,
    key: KeyMaterial,
  ) {
    if (
      !Number.isSafeInteger(key.keyVersion) ||
      key.keyVersion < 1 ||
      key.keyVersion > 2_147_483_647
    ) {
      throw new TypeError("Secret key version must be a positive integer");
    }
    if (key.masterKey.byteLength !== 32) {
      throw new TypeError("Secret master key must contain exactly 32 bytes");
    }
    this.key = { keyVersion: key.keyVersion, masterKey: Buffer.from(key.masterKey) };
  }

  async write(input: SecretWriteInput): Promise<SecretWriteReceipt> {
    return this.writeTransaction(input);
  }

  async writeProviderCredential(input: ProviderCredentialWriteInput): Promise<SecretWriteReceipt> {
    const accountId = AccountIdSchema.parse(input.accountId);
    return this.writeTransaction(
      {
        commandId: input.commandId,
        secretRef: `secret-store:accounts/${accountId}/provider-api-key`,
        purpose: "PROVIDER_API_KEY",
        plaintext: input.plaintext,
        writtenAt: input.writtenAt,
      },
      accountId,
    );
  }

  private async writeTransaction(
    input: SecretWriteInput,
    accountId?: ReturnType<typeof AccountIdSchema.parse>,
  ): Promise<SecretWriteReceipt> {
    validateInput(input);
    const hash = requestHash(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          input.commandId,
        ]);
        const receipt = (
          await client.query<ReceiptRow>(
            `SELECT request_sha256, secret_ref, version
               FROM agent_world.secret_write_receipts
              WHERE command_id = $1
              FOR UPDATE`,
            [input.commandId],
          )
        ).rows[0];
        if (receipt) {
          if (receipt.request_sha256 !== hash || receipt.secret_ref !== input.secretRef) {
            throw new SecretStoreError("IDEMPOTENCY_CONFLICT");
          }
          await client.query("COMMIT");
          return {
            schemaVersion: 1,
            outcome: "REPLAY",
            secretRef: receipt.secret_ref,
            version: receipt.version,
          };
        }

        const existing = (
          await client.query<VersionRow>(
            `SELECT version, created_at
               FROM agent_world.encrypted_secrets
              WHERE secret_ref = $1
              FOR UPDATE`,
            [input.secretRef],
          )
        ).rows[0];
        const version = (existing?.version ?? 0) + 1;
        const encrypted = encrypt(
          input.plaintext,
          input.secretRef,
          input.purpose,
          version,
          this.key,
        );
        await client.query(
          `INSERT INTO agent_world.encrypted_secrets
             (secret_ref, purpose, version, algorithm, key_version, nonce,
              ciphertext, auth_tag, created_at, rotated_at)
           VALUES ($1, $2, $3, 'AES-256-GCM', $4, $5, $6, $7, $8, $8)
           ON CONFLICT (secret_ref) DO UPDATE
             SET purpose = EXCLUDED.purpose,
                 version = EXCLUDED.version,
                 algorithm = EXCLUDED.algorithm,
                 key_version = EXCLUDED.key_version,
                 nonce = EXCLUDED.nonce,
                 ciphertext = EXCLUDED.ciphertext,
                 auth_tag = EXCLUDED.auth_tag,
                 rotated_at = EXCLUDED.rotated_at`,
          [
            input.secretRef,
            input.purpose,
            version,
            this.key.keyVersion,
            encrypted.nonce,
            encrypted.ciphertext,
            encrypted.authTag,
            input.writtenAt,
          ],
        );
        const outcome = existing ? "ROTATED" : "CREATED";
        if (accountId !== undefined) {
          const bound = await client.query<{ id: string }>(
            `UPDATE agent_world.accounts a
                SET credential_ref = $2, health = 'ACTIVE'
               FROM agent_world.providers p
              WHERE a.id = $1
                AND p.id = a.provider_id
                AND p.category = 'LLM_API'
                AND p.is_enabled = true
                AND a.auth_mechanism = 'API_KEY'
                AND a.is_enabled = true
              RETURNING a.id`,
            [accountId, input.secretRef],
          );
          if (bound.rows.length !== 1 || bound.rows[0]?.id !== accountId) {
            throw new SecretStoreError("INVALID_REFERENCE");
          }
        }
        await client.query(
          `INSERT INTO agent_world.secret_write_receipts
             (command_id, request_sha256, secret_ref, version, outcome, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [input.commandId, hash, input.secretRef, version, outcome, input.writtenAt],
        );
        await client.query("COMMIT");
        return { schemaVersion: 1, outcome, secretRef: input.secretRef, version };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async read(secretRef: string, purpose: SecretPurpose): Promise<string> {
    validateReference(secretRef, purpose);
    const client = await this.pool.connect();
    try {
      const row = (
        await client.query<SecretRow>(
          `SELECT secret_ref, purpose, version, algorithm, key_version,
                  nonce, ciphertext, auth_tag
             FROM agent_world.encrypted_secrets
            WHERE secret_ref = $1`,
          [secretRef],
        )
      ).rows[0];
      if (!row) throw new SecretStoreError("NOT_FOUND");
      if (
        row.secret_ref !== secretRef ||
        row.purpose !== purpose ||
        row.algorithm !== "AES-256-GCM" ||
        row.key_version !== this.key.keyVersion ||
        !Number.isSafeInteger(row.version) ||
        row.version < 1 ||
        row.nonce.byteLength !== 12 ||
        row.auth_tag.byteLength !== 16
      ) {
        throw new SecretStoreError("DECRYPTION_FAILED");
      }
      try {
        const decipher = createDecipheriv("aes-256-gcm", this.key.masterKey, row.nonce, {
          authTagLength: 16,
        });
        decipher.setAAD(additionalData(secretRef, purpose, row.version, row.key_version));
        decipher.setAuthTag(row.auth_tag);
        return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
      } catch {
        throw new SecretStoreError("DECRYPTION_FAILED");
      }
    } finally {
      client.release();
    }
  }
}
