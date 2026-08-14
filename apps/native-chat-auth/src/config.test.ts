import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, parseAccountId } from "./config.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "agent-world-oauth-"));
  temporaryDirectories.push(directory);
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  const jwks = join(directory, "jwks.json");
  const cookies = join(directory, "cookies.json");
  await writeFile(
    jwks,
    JSON.stringify({ keys: [{ ...jwk, kid: "key-1", alg: "ES256", use: "sig" }] }),
  );
  await writeFile(
    cookies,
    JSON.stringify([randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")]),
  );
  return { jwks, cookies };
}

describe("native Chat OAuth configuration", () => {
  it("accepts one exact HTTPS issuer/resource profile", async () => {
    const files = await fixture();
    await expect(
      loadConfig({
        AGENT_WORLD_MCP_OAUTH_ISSUER: "https://world.example/oauth",
        AGENT_WORLD_MCP_RESOURCE: "https://world.example/api/mcp",
        AGENT_WORLD_OWNER_PASSWORD_HASH: `scrypt-v1$32768$8$1$${"a".repeat(22)}$${"b".repeat(43)}`,
        AGENT_WORLD_MCP_OAUTH_JWKS_FILE: files.jwks,
        AGENT_WORLD_MCP_OAUTH_COOKIE_KEYS_FILE: files.cookies,
      }),
    ).resolves.toMatchObject({ prefix: "/oauth", scope: "ai_world.run.write" });
  });

  it("rejects insecure or ambiguous endpoints and non-canonical accounts", async () => {
    const files = await fixture();
    const environment = {
      AGENT_WORLD_MCP_OAUTH_ISSUER: "http://world.example/oauth",
      AGENT_WORLD_MCP_RESOURCE: "https://world.example/api/mcp",
      AGENT_WORLD_OWNER_PASSWORD_HASH: `scrypt-v1$32768$8$1$${"a".repeat(22)}$${"b".repeat(43)}`,
      AGENT_WORLD_MCP_OAUTH_JWKS_FILE: files.jwks,
      AGENT_WORLD_MCP_OAUTH_COOKIE_KEYS_FILE: files.cookies,
    };
    await expect(loadConfig(environment)).rejects.toThrow(/HTTPS/);
    expect(parseAccountId("account_11111111-1111-1111-1111-111111111111")).toBeTruthy();
    expect(parseAccountId("agent_11111111-1111-1111-1111-111111111111")).toBeUndefined();
  });
});
