import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TransactionClient, TransactionPool } from "./conversation-store.js";
import { PostgresEncryptedSecretStore, SecretStoreError } from "./encrypted-secret-store.js";

type Stored = {
  secret_ref: string;
  purpose: string;
  version: number;
  algorithm: string;
  key_version: number;
  nonce: Buffer;
  ciphertext: Buffer;
  auth_tag: Buffer;
  created_at: string;
  rotated_at: string;
};

function fakeDatabase() {
  const secrets = new Map<string, Stored>();
  const receipts = new Map<
    string,
    { request_sha256: string; secret_ref: string; version: number }
  >();
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const client: TransactionClient = {
    async query<Row>(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      if (text.includes("FROM agent_world.secret_write_receipts")) {
        const receipt = receipts.get(String(values[0]));
        return { rows: (receipt ? [receipt] : []) as Row[] };
      }
      if (text.includes("FROM agent_world.encrypted_secrets") && text.includes("FOR UPDATE")) {
        const stored = secrets.get(String(values[0]));
        return {
          rows: (stored
            ? [{ version: stored.version, created_at: stored.created_at }]
            : []) as Row[],
        };
      }
      if (text.includes("INSERT INTO agent_world.encrypted_secrets")) {
        const existing = secrets.get(String(values[0]));
        const stored: Stored = {
          secret_ref: String(values[0]),
          purpose: String(values[1]),
          version: Number(values[2]),
          algorithm: "AES-256-GCM",
          key_version: Number(values[3]),
          nonce: Buffer.from(values[4] as Buffer),
          ciphertext: Buffer.from(values[5] as Buffer),
          auth_tag: Buffer.from(values[6] as Buffer),
          created_at: existing?.created_at ?? String(values[7]),
          rotated_at: String(values[7]),
        };
        secrets.set(stored.secret_ref, stored);
        return { rows: [] as Row[] };
      }
      if (text.includes("INSERT INTO agent_world.secret_write_receipts")) {
        receipts.set(String(values[0]), {
          request_sha256: String(values[1]),
          secret_ref: String(values[2]),
          version: Number(values[3]),
        });
        return { rows: [] as Row[] };
      }
      if (text.includes("UPDATE agent_world.accounts")) {
        return { rows: [{ id: String(values[0]) }] as Row[] };
      }
      if (text.includes("FROM agent_world.encrypted_secrets") && !text.includes("FOR UPDATE")) {
        const stored = secrets.get(String(values[0]));
        return { rows: (stored ? [stored] : []) as Row[] };
      }
      return { rows: [] as Row[] };
    },
    release() {},
  };
  return {
    pool: { connect: async () => client } satisfies TransactionPool,
    queries,
    secrets,
  };
}

const input = {
  commandId: "secret-write-1",
  secretRef: "secret-store:provider/account-1/api-key",
  purpose: "PROVIDER_API_KEY" as const,
  plaintext: "provider-super-secret",
  writtenAt: "2026-08-13T12:00:00.000Z",
};

describe("PostgresEncryptedSecretStore", () => {
  it("encrypts provider keys with fresh authenticated nonces and never queries plaintext", async () => {
    const database = fakeDatabase();
    const store = new PostgresEncryptedSecretStore(database.pool, {
      keyVersion: 1,
      masterKey: randomBytes(32),
    });

    await expect(store.write(input)).resolves.toEqual({
      schemaVersion: 1,
      outcome: "CREATED",
      secretRef: input.secretRef,
      version: 1,
    });
    expect(await store.read(input.secretRef, "PROVIDER_API_KEY")).toBe(input.plaintext);
    const persistedValues = JSON.stringify(
      database.queries.map(({ values }) =>
        values.map((value) => (Buffer.isBuffer(value) ? value.toString("hex") : value)),
      ),
    );
    expect(persistedValues).not.toContain(input.plaintext);
    expect(database.secrets.get(input.secretRef)?.nonce).toHaveLength(12);
    expect(database.secrets.get(input.secretRef)?.auth_tag).toHaveLength(16);
  });

  it("rotates atomically with a different nonce and monotonic version", async () => {
    const database = fakeDatabase();
    const store = new PostgresEncryptedSecretStore(database.pool, {
      keyVersion: 1,
      masterKey: randomBytes(32),
    });
    await store.write(input);
    const firstNonce = Buffer.from(database.secrets.get(input.secretRef)?.nonce ?? []);
    const rotated = await store.write({
      ...input,
      commandId: "secret-write-2",
      plaintext: "rotated-secret",
      writtenAt: "2026-08-13T12:01:00.000Z",
    });
    expect(rotated).toMatchObject({ outcome: "ROTATED", version: 2 });
    expect(database.secrets.get(input.secretRef)?.nonce).not.toEqual(firstNonce);
    expect(await store.read(input.secretRef, "PROVIDER_API_KEY")).toBe("rotated-secret");
  });

  it("replays identical commands and rejects changed payloads", async () => {
    const database = fakeDatabase();
    const store = new PostgresEncryptedSecretStore(database.pool, {
      keyVersion: 1,
      masterKey: randomBytes(32),
    });
    await store.write(input);
    await expect(store.write(input)).resolves.toMatchObject({ outcome: "REPLAY", version: 1 });
    await expect(store.write({ ...input, plaintext: "different" })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("fails closed for the wrong key or purpose", async () => {
    const database = fakeDatabase();
    const store = new PostgresEncryptedSecretStore(database.pool, {
      keyVersion: 1,
      masterKey: randomBytes(32),
    });
    await store.write(input);
    const wrongKeyStore = new PostgresEncryptedSecretStore(database.pool, {
      keyVersion: 1,
      masterKey: randomBytes(32),
    });
    await expect(wrongKeyStore.read(input.secretRef, input.purpose)).rejects.toBeInstanceOf(
      SecretStoreError,
    );
    await expect(store.read(input.secretRef, "OTHER" as never)).rejects.toMatchObject({
      code: "INVALID_REFERENCE",
    });
  });

  it("binds an API-key Account to only its opaque derived reference", async () => {
    const database = fakeDatabase();
    const store = new PostgresEncryptedSecretStore(database.pool, {
      keyVersion: 1,
      masterKey: randomBytes(32),
    });
    const receipt = await store.writeProviderCredential({
      commandId: "provider-key-write-1",
      accountId: "account_33333333-3333-3333-3333-333333333333",
      plaintext: "provider-key",
      writtenAt: "2026-08-13T12:00:00.000Z",
    });
    expect(receipt).toMatchObject({
      outcome: "CREATED",
      secretRef:
        "secret-store:accounts/account_33333333-3333-3333-3333-333333333333/provider-api-key",
    });
    const binding = database.queries.find(({ text }) =>
      text.includes("UPDATE agent_world.accounts"),
    );
    expect(binding?.values).toEqual([
      "account_33333333-3333-3333-3333-333333333333",
      "secret-store:accounts/account_33333333-3333-3333-3333-333333333333/provider-api-key",
    ]);
  });
});
