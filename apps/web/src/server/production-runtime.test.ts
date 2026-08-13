import { describe, expect, it } from "vitest";
import { parseDatabasePoolConfig, parseSecretKeyMaterial } from "./production-runtime";

describe("production runtime configuration", () => {
  it("accepts explicit verified TLS without leaking URL components", () => {
    const config = parseDatabasePoolConfig({
      DATABASE_URL: "postgresql://agent_world:secret@db.internal:5432/agent_world",
      AGENT_WORLD_DATABASE_TLS: "verify-full",
    });
    expect(config).toMatchObject({
      max: 10,
      ssl: { rejectUnauthorized: true },
      application_name: "agent-world-web",
    });
  });

  it("allows plaintext only on loopback or an acknowledged private network", () => {
    expect(
      parseDatabasePoolConfig({
        DATABASE_URL: "postgresql://agent_world:secret@127.0.0.1:5432/agent_world",
        AGENT_WORLD_DATABASE_TLS: "disable",
      }).ssl,
    ).toBe(false);
    expect(
      parseDatabasePoolConfig({
        DATABASE_URL: "postgresql://agent_world:secret@postgres:5432/agent_world",
        AGENT_WORLD_DATABASE_TLS: "disable",
        AGENT_WORLD_DATABASE_PLAINTEXT_ACK: "private-network",
      }).ssl,
    ).toBe(false);
    expect(() =>
      parseDatabasePoolConfig({
        DATABASE_URL: "postgresql://agent_world:secret@db.internal:5432/agent_world",
        AGENT_WORLD_DATABASE_TLS: "disable",
      }),
    ).toThrow("private-network");
  });

  it("rejects ambiguous URLs, URL options and missing TLS policy", () => {
    for (const environment of [
      {},
      { DATABASE_URL: "https://agent_world:secret@db.internal/agent_world" },
      { DATABASE_URL: "postgresql://agent_world@db.internal/agent_world" },
      {
        DATABASE_URL: "postgresql://agent_world:secret@db.internal/agent_world?sslmode=disable",
        AGENT_WORLD_DATABASE_TLS: "verify-full",
      },
      { DATABASE_URL: "postgresql://agent_world:secret@db.internal/agent_world" },
    ]) {
      expect(() => parseDatabasePoolConfig(environment)).toThrow();
    }
  });

  it("accepts only canonical 32-byte base64url secret key material", () => {
    const encoded = Buffer.alloc(32, 7).toString("base64url");
    expect(
      parseSecretKeyMaterial({
        AGENT_WORLD_SECRET_MASTER_KEY: encoded,
        AGENT_WORLD_SECRET_KEY_VERSION: "2",
      }),
    ).toEqual({ keyVersion: 2, masterKey: Buffer.alloc(32, 7) });
    for (const environment of [
      {},
      { AGENT_WORLD_SECRET_MASTER_KEY: encoded, AGENT_WORLD_SECRET_KEY_VERSION: "0" },
      { AGENT_WORLD_SECRET_MASTER_KEY: "not-a-key", AGENT_WORLD_SECRET_KEY_VERSION: "1" },
      { AGENT_WORLD_SECRET_MASTER_KEY: `${encoded}=`, AGENT_WORLD_SECRET_KEY_VERSION: "1" },
    ]) {
      expect(() => parseSecretKeyMaterial(environment)).toThrow();
    }
  });
});
